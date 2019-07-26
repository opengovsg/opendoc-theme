---
---
(function () {
    // Search Box Element
    // =============================================================================
    var siteSearchElement = document.getElementsByClassName('search-box')[0]
    var searchBoxElement = document.getElementById('search-box')
    var clearButton = document.getElementsByClassName('clear-button')[0]
    var main = document.getElementsByTagName('main')[0]
    var searchFilter = document.getElementsByClassName('search-filter')[0]
    var searchResults = document.getElementsByClassName('search-results')[0]

    searchBoxElement.oninput = function (event) {
        if (searchBoxElement.value && searchBoxElement.value.trim().length > 0) {
            siteSearchElement.classList.add('filled')
            onSearchChangeDebounced()
        } else {
            siteSearchElement.classList.remove('filled')
            onSearchChange()
        }
    }

    searchBoxElement.onfocus = function () {
        siteSearchElement.classList.add('focused')
        if (siteSearchElement.classList.contains('filled')) {
            searchResults.classList.add('visible')
        }
    }

    searchBoxElement.onblur = function() {
        siteSearchElement.classList.remove('focused')
    }

    document.body.addEventListener('click', function (event) {
        var target = event.target
        if (target.id !== 'search-box' && !target.classList.contains('search-btn') && !target.parentNode.classList.contains('search-btn')) {
            searchResults.classList.remove('visible')
        }
    })

    clearButton.onclick = function () {
        searchBoxElement.value = ''
        searchBoxElement.dispatchEvent(new Event('input', {
            'bubbles': true,
            'cancelable': true
        }))
    }

    // Assign search endpoint based on env config
    // ===========================================================================
    var endpoint = null
    var env = '{{ jekyll.environment }}'
    var elasticSearchIndex = '{{site.github.owner_name}}-{{site.github.repository_name}}'

    if (env === 'production') {
        endpoint = '{{ site.server_PROD | append: '/' }}' + elasticSearchIndex
    } else {
        //  Allow overriding of search index in dev env
        var configElasticSearchIndex = '{{site.elastic_search_index}}'
        if (configElasticSearchIndex) {
            elasticSearchIndex = configElasticSearchIndex
        }
        endpoint = '{{ site.server_DEV | append: '/' }}' + elasticSearchIndex
    }

    var search_endpoint = endpoint + '/search'


    // Global Variables
    // =============================================================================

    var wordsToHighlight = []
    var sectionIndex = {}
    var minQueryLength = 3
    var lunrIndex = null
    // Begin Lunr Indexing
    // =============================================================================
    function getLunrIndex() {
        return fetch('{{ "/assets/lunrIndex.json" | relative_url }}')
            .then(function (res) {
                    return res.json()
            })
            .then(function (json) {
                lunrIndex = lunr.Index.load(json.index)
                lunrIndex.pipeline.remove(lunr.stemmer)
                sectionIndex = json.sectionIndex
            })
            .catch(function (err) {
                console.error('Fetch failed to read the Lunr index: ' + err)
            })
    }

    // Load Lunr Index if set
    // ============================================================================
    var searchSetOffline = "{{ site.offline }}" === "true" || false

    if (searchSetOffline) {
        getLunrIndex()
    }

    // Search
    // =============================================================================
    // Helper function to translate lunr search results
    // Returns a simple { title, content, link } array
    var snippetSpace = 40
    var maxSnippets = 4
    var maxResults = 10
    var translateLunrResults = function (allLunrResults) {
        var lunrResults = allLunrResults.slice(0, maxResults)
        return lunrResults.map(function (result) {
            var matchedDocument = sectionIndex[result.ref]
            var contentSnippets = []
            var titleSnippets = []
            var snippetsRangesByFields = {}
            // Loop over matching terms
            var rangesByFields = {}
            // Group ranges according to field type(text / title)
            for (var term in result.matchData.metadata) {
                // To highlight the main body later
                wordsToHighlight.push(term)
                var fields = result.matchData.metadata[term]
                for (var field in fields) {
                    positions = fields[field].position
                    rangesByFields[field] = rangesByFields[field] ? rangesByFields[field].concat(positions) : positions
                }
            }
            var snippetCount = 0
            // Sort according to ascending snippet range
            for (var field in rangesByFields) {
                var ranges = rangesByFields[field]
                    .map(function (a) {
                        return [a[0] - snippetSpace, a[0] + a[1] + snippetSpace, a[0], a[0] + a[1]]
                    })
                    .sort(function (a, b) {
                        return a[0] - b[0]
                    })
                // Merge contiguous ranges
                var startIndex = ranges[0][0]
                var endIndex = ranges[0][1]
                var mergedRanges = []
                var highlightRanges = []
                for (rangeIndex in ranges) {
                    var range = ranges[rangeIndex]
                    snippetCount++
                    if (range[0] <= endIndex) {
                        endIndex = Math.max(range[1], endIndex)
                        highlightRanges = highlightRanges.concat([range[2], range[3]])
                    } else {
                        mergedRanges.push([startIndex].concat(highlightRanges).concat([endIndex]))
                        startIndex = range[0]
                        endIndex = range[1]
                        highlightRanges = [range[2], range[3]]
                    }
                    if (snippetCount >= maxSnippets) {
                        mergedRanges.push([startIndex].concat(highlightRanges).concat([endIndex]))
                        snippetsRangesByFields[field] = mergedRanges
                        break
                    }
                    if (+rangeIndex === ranges.length - 1) {
                        if (snippetCount + 1 < maxSnippets) {
                            snippetCount++
                        }
                        mergedRanges.push([startIndex].concat(highlightRanges).concat([endIndex]))
                        snippetsRangesByFields[field] = mergedRanges
                        if (snippetCount >= maxSnippets) {
                            break
                        }
                    }
                }
            }
            // Extract snippets and add highlights to search results
            for (var field in snippetsRangesByFields) {
                positions = snippetsRangesByFields[field]
                positions.forEach(function (position) {
                    matchedText = matchedDocument[field]
                    var snippet = ''
                    // If start of matched text dont use ellipsis
                    if (position[0] > 0) {
                        snippet += '...'
                    }
                    snippet += matchedText.substring(position[0], position[1])
                    for (var i = 1; i <= position.length - 2; i++) {
                        if (i % 2 == 1) {
                            snippet += '<mark>'
                        } else {
                            snippet += '</mark>'
                        }
                        snippet += matchedText.substring(position[i], position[i + 1])
                    }
                    if (field === 'title') {
                        titleSnippets.push(snippet)
                    } else {
                        snippet += '...'
                        contentSnippets.push(snippet)
                    }
                })
            }
            var joinHighlights = function (str) {
                if (str) {
                    return str.replace(/<\/mark> <mark>/g, ' ')
                }
            }
            // Build a simple flat object per lunr result
            return {
                title: joinHighlights(titleSnippets.length === 0 ? matchedDocument.title: titleSnippets.join(' ')),
                documentTitle: joinHighlights(matchedDocument.documentTitle),
                content: joinHighlights(contentSnippets.join(' ')),
                url: matchedDocument.url
            }
        })
    }

    // Displays the search results in HTML
    // Takes an array of objects with "title" and "content" properties
    var renderSearchResultsFromLunr = function (searchResults) {
        var container = document.getElementsByClassName('search-results')[0]
        container.scrollTop = 0
        container.innerHTML = ''
        if (!searchResults || searchResults.length === 0) {
            var error = generateErrorHTML()
            container.append(error)
        } else {
            searchResults.forEach(function (result, i) {
                var element = generateResultHTML(result, i)
                container.appendChild(element)
            })
        }
    }

    var renderSearchResultsFromServer = function (searchResults) {
        var container = document.getElementsByClassName('search-results')[0]
        container.scrollTop = 0
        container.innerHTML = ''
        if (typeof searchResults.hits === 'undefined') {
            var error = document.createElement('p')
            error.classList.add('not-found')
            error.innerHTML = searchResults
            container.appendChild(error)
            // Check if there are hits and max_score is more than 0 
            // Max score is checked as well as filter will always return something
        } else if (searchResults.hits.hits.length === 0 || searchResults.hits['max_score'] === 0) {
            var error = generateErrorHTML()
            container.appendChild(error)
        } else {
            searchResults.hits.hits.forEach(function (result, i) {
                if (result._score) {
                    var formatted = formatResult(result, i)
                    var element = generateResultHTML(formatted)
                    container.appendChild(element)
                }
            });
            highlightBody()
        }
    }

    var generateErrorHTML = function () {
        var error = document.createElement('p')
        error.innerHTML = 'Results matching your query were not found.'
        error.classList.add('not-found')
        return error
    }

    var generateResultHTML = function (result, i) {
        var element = document.createElement('a')
        element.className = 'search-link nav-link'
        var urlParts = result.url.split('/')
        urlParts = urlParts.filter(function (part) {
            return part !== ''
        })
        element.href = '/' + urlParts.join('/')
        var searchResult = document.createElement('div')
        var searchTitle = document.createElement('p')
        searchTitle.className = 'search-title'
        searchTitle.innerHTML = result.documentTitle || '{{ site.title }}'
        searchResult.appendChild(searchTitle)
        var searchSubtitle = document.createElement('p')
        searchSubtitle.className = 'search-subtitle'
        searchSubtitle.innerHTML = result.title
        searchResult.appendChild(searchSubtitle)
        var searchContent = document.createElement('p')
        searchContent.className = 'search-content'
        searchContent.innerHTML = result.content
        searchResult.appendChild(searchContent)
        element.onmouseup = function() {
            searchResults.classList.remove('visible')
        }
        element.appendChild(searchResult)
        return element
    }

    formatResult = function (result) {
        var content = null
        var title = result._source.title
        var url = result._source.url;
        var documentTitle = result._source.documentTitle;
        var regex = /<mark>(.*?)<\/mark>/g
        var joinHighlights = function (str) {
            if (str) {
                return str.replace(/<\/mark> <mark>/g, ' ')
            }
        }
        if (result.highlight) {
            ['title', 'content'].forEach(function (field) {
                var curr, match, term;
                if (result.highlight[field]) {
                    var curr = result.highlight[field].join('...')
                    //  trimLeft not supported in IE
                    var curr = curr.replace(/^\s+/, "")
                    var curr = joinHighlights(curr)
                    var match = true
                    while (match) {
                        match = regex.exec(curr)
                        if (match) {
                            var term = match[1].toLowerCase()
                            if ((wordsToHighlight.indexOf(term)) < 0) {
                                wordsToHighlight.push(term)
                            }
                        }
                    }
                }
            })
            if (result.highlight.content) {
                content = joinHighlights(result.highlight.content.slice(0, Math.min(3, result.highlight.content.length)).join('...'))
            }
            if (result.highlight.title) {
                title = joinHighlights(result.highlight.title[0])
            }
        }
        return {
            url: url,
            content: content ? '...' + content + '...' : '',
            title: title,
            documentTitle: documentTitle
        }
    }

    var debounce = function (func, threshold, execAsap) {
        var timeout = null;
        return function () {
            var args = 1 <= arguments.length ? slice.call(arguments, 0) : []
            obj = this
            var delayed = function () {
                if (!execAsap) {
                    func.apply(obj, args)
                }
                timeout = null
            }
            if (timeout) {
                clearTimeout(timeout)
            } else if (execAsap) {
                func.apply(obj, args)
            }
            timeout = setTimeout(delayed, threshold || 100)
        }
    }


    var createEsQuery = function (queryStr) {
        var source = ['title', 'url', 'documentTitle']
        var title_automcomplete_q = {
            'match_phrase_prefix': {
                'title': {
                    'query': queryStr,
                    'max_expansions': 20,
                    'boost': 100,
                    'slop': 10
                }
            }
        }
        var content_automcomplete_q = {
            'match_phrase_prefix': {
                'content': {
                    'query': queryStr,
                    'max_expansions': 20,
                    'boost': 60,
                    'slop': 10
                }
            }
        }
        var title_keyword_q = {
            'match': {
                'title': {
                    'query': queryStr,
                    'fuzziness': 'AUTO',
                    'max_expansions': 10,
                    'boost': 20,
                    'analyzer': 'stop'
                }
            }
        }
        var content_keyword_q = {
            'match': {
                'content': {
                    'query': queryStr,
                    'fuzziness': 'AUTO',
                    'max_expansions': 10,
                    'analyzer': 'stop'
                }
            }
        }

        var bool_q = {
            'bool': {
                'should': [title_automcomplete_q, content_automcomplete_q, title_keyword_q, content_keyword_q],
            }
        }

        // If document filter is present
        var page = pageIndex[window.location.pathname]
        if (!searchFilter.classList.contains('hidden') && page && page.documentInfo[0]) {
            // documentId is the alphanumeric and lowercase version of document title
            // used as a keyword filter to search within the document
            var documentId = page.documentInfo[0].replace(/[^\w]/g, '').toLowerCase()
            var filter_by_document = {
                'term': {
                    'documentId': documentId
                }
            }
            bool_q.bool.filter = filter_by_document
        }

        var highlight = {}
        highlight.require_field_match = false
        highlight.fields = {}
        highlight.fields['content'] = {
            'fragment_size': 80,
            'number_of_fragments': 6,
            'pre_tags': ['<mark>'],
            'post_tags': ['</mark>']
        }
        highlight.fields['title'] = {
            'fragment_size': 80,
            'number_of_fragments': 6,
            'pre_tags': ['<mark>'],
            'post_tags': ['</mark>']
        }
        return {
            '_source': source,
            'query': bool_q,
            'highlight': highlight
        }
    }

    // Call the API
    esSearch = function (query) {
        var esQuery = createEsQuery(query)
        fetch(search_endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(esQuery)
        })
            .then(checkStatus)
            .then(parseJSON)
            .then(function (data) {
                renderSearchResultsFromServer(data.body)
            })
            .catch(function (err) {
                console.error(err)
                renderSearchResultsFromServer('Failed to fetch search results')
            })
    }

    var lunrSearch = function (query) {
        // Add wildcard before and after
        var queryTerm = refineLunrSearchQuery(query)
        if (lunrIndex !== null) {
            var lunrResults = lunrIndex.search(queryTerm)
            var results = translateLunrResults(lunrResults)
            highlightBody()
            renderSearchResultsFromLunr(results)
        }
    }

    var refineLunrSearchQuery = function(query) {
        FUZZY_FACTOR = 4 // range: 1 to INF. Lower is fuzzier *relative to term length*.
        var addFuzzyOperator = function(term, fuzziness) {
            return term + '~' + 
                Math.floor(term.length / Math.max(1, fuzziness)).toString()
        }
        var stringIsLettersOnly = function(str) {
            return /^[a-zA-Z]+$/.test(str)
        }

        var terms = query.split(' ')
        terms = terms.map(function(term) {
            if (stringIsLettersOnly(term)) {
                return addFuzzyOperator(term, FUZZY_FACTOR)
            }           
            return term
        })
        return terms.join(' ')
    }


    var onSearchChange = function () {
        var query = searchBoxElement.value.trim()
        // Clear highlights
        wordsToHighlight = []
        if (query.length < minQueryLength) {
            searchResults.classList.remove('visible')
            highlightBody()
            return
        }
        searchResults.classList.add('visible')

        if (searchSetOffline) {
            lunrSearch(query)
        } else {
            esSearch(query)
            if (env === 'production' && window.ga) {
                window.ga('send', 'pageview', '/search?query=' + encodeURIComponent(query))
            }
        }
    }

    var onSearchChangeDebounced = debounce(onSearchChange, 500, false)

    var isBackspaceFirstPress = true
    var isBackspacePressedOnEmpty = false
    // Detect that backspace is not part of longpress
    searchBoxElement.onkeydown = function (e) {
        searchResults.classList.remove('hidden')
        if (isBackspaceFirstPress && e.keyCode === 8) {
            isBackspaceFirstPress = false
            if (searchBoxElement.value === '') {
                isBackspacePressedOnEmpty = true
            }
        }
    }

    clearSearchFilter = function () {
        searchFilter.classList.add('hidden')
    }

    searchFilter.onclick = clearSearchFilter

    searchBoxElement.onkeyup = function (e) {
        // flash search results on enter
        if (e.keyCode === 13) {
            var container = document.getElementsByClassName('search-results')[0]
            container.style.opacity = 0
            return setTimeout(function () {
                return container.style.opacity = 1
            }, 100)
        }
        // Delete filter on backspace when input is empty and not part of longpress
        if (e.keyCode === 8) {
            isBackspaceFirstPress = true
            if (searchBoxElement.value === '' && isBackspacePressedOnEmpty) {
                clearSearchFilter()
                isBackspacePressedOnEmpty = false
                return
            }
        }
    }


    // Highlighting
    // ============================================================================
    window.highlightBody = function () {
        // Check if Mark.js script is already imported
        if (Mark) {
            var instance = new Mark(main)
            instance.unmark()
            if (wordsToHighlight.length > 0) {
                instance.mark(wordsToHighlight, {
                    exclude: ['h1'],
                    accuracy: {
                        value: 'exactly',
                        limiters: [',', '.', '(', ')', '-', '\'', '[', ']', '?', '/', '\\', ':', '*', '!', '@', '&']
                    },
                    separateWordSearch: false
                })
            }
        }
    }

})()
