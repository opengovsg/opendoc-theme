---
---
(function() {
    // Search Box Element
    // =============================================================================
    // This allows the search box to be hidden if javascript is disabled
    var siteSearchElement = document.getElementsByClassName('search-box')[0]
    var searchBoxElement = document.getElementById('search-box')
    var clearButton = document.getElementsByClassName('clear-button')[0]
    var main = document.getElementsByTagName('main')[0]

    searchBoxElement.oninput = function (event) {
        if (searchBoxElement.value && searchBoxElement.value.trim().length > 0) {
            siteSearchElement.classList.add('filled')
        } else {
            siteSearchElement.classList.remove('filled')
        }
    }

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

    if (env == 'production') {
        endpoint = {{ site.server_PROD | append: '/' | jsonify }} + elasticSearchIndex
    } else {
        //  Allow overriding of search index in dev env
        var configElasticSearchIndex = '{{site.elastic_search_index}}'
        if (configElasticSearchIndex) {
            elasticSearchIndex = configElasticSearchIndex
        }
        endpoint = {{ site.server_DEV | append: '/' | jsonify }} + elasticSearchIndex
    }

    var search_endpoint = endpoint + '/search'


    // Global Variables
    // =============================================================================

    var wordsToHighlight =[]
    var sectionIndex = {}
    var lunrIndex = null
    var searchOnServer = false

    // Site Hierarchy
    // =============================================================================

    var startBuildingIndex = function (sections) {
        searchBoxElement.setAttribute('placeholder', 'Building search index...')
        var promise = new Promise(function (resolve, reject) {
            var worker = new Worker("{{ '/assets/worker.js' | relative_url }}")
            worker.onmessage = function (event) {
                worker.terminate()
                resolve(lunr.Index.load(event.data))
            }
            worker.onerror = function (error) {
                Promise.reject(error)
            }
            worker.postMessage(sections)
        })
        return promise
    }

    var searchIndexPromise = new Promise(function(resolve, reject) {
        var req = new XMLHttpRequest()
        req.addEventListener('readystatechange', function() {
        //  ReadyState Complete
            if (req.readyState === 4) {
                var successResultCodes = [200, 304]
                if (!successResultCodes.includes(req.status)) {
                    startBuildingLunrIndex(resolve)
                } else {
                    searchOnServer = true
                    resolve('Connected to server')
                }
            }
        })
        req.open('GET', search_endpoint, true)
        req.setRequestHeader('X-Requested-With', 'XMLHttpRequest')
        req.send('')
    })

    var startBuildingLunrIndex = function(cb) {
        startLunrIndexing().then(function(results) {
            sectionIndex = results.sectionIndex
            lunrIndex = lunr.Index.load(results.index)
            cb()
        })
    }

    // Search
    // =============================================================================
    // Helper function to translate lunr search results
    // Returns a simple { title, content, link } array
    var snippetSpace = 40
    var maxSnippets = 4
    var maxResults = 10
    var minQueryLength = 3
    var translateLunrResults = function (allLunrResults) {
        var lunrResults = allLunrResults.slice(0, maxResults)
        return lunrResults.map(function(result) {
            var matchedDocument = sectionIndex[result.ref]
            var snippets = []
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
                    .map(function(a) {
                        return [a[0] - snippetSpace, a[0] + a[1] + snippetSpace, a[0], a[0] + a[1]]
                    })
                    .sort(function(a, b) {
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
                positions.forEach(function(position) {
                    matchedText = matchedDocument[field]
                    snippet = ''
                    // If start of matched text dont use ellipsis
                    if (position[0] > 0) {
                        snippet += '...'
                    }
                    snippet += matchedText.substring(position[0], position[1])
                    for (var i = 1; i <= position.length - 2; i ++ ) {
                        if (i % 2 == 1) {
                            snippet += '<mark>'
                        } else {
                            snippet += '</mark> '
                        }
                        snippet += matchedText.substring(position[i], position[i + 1])
                    }
                    snippet += '...'
                    snippets.push(snippet)
                })
            }
            // Build a simple flat object per lunr result
            return {
                title: matchedDocument.title,
                content: snippets.join(' '),
                url: matchedDocument.url
            }
        })
    }

    // Displays the search results in HTML
    // Takes an array of objects with "title" and "content" properties
    var renderSearchResults = function(searchResults) {
        var container = document.getElementsByClassName('search-results')[0]
        container.innerHTML = ''
        if (!searchResults || searchResults.length === 0) {
            var error = generateErrorHTML()
            container.append(error)
        } else {
            searchResults.forEach(function(result, i) {
                var element = generateResultHTML(result, i)
                container.appendChild(element)
            })
        }
    }

    var renderSearchResultsFromServer = function(searchResults) {
        var container = document.getElementsByClassName('search-results')[0]
        container.innerHTML = ''
        if (typeof searchResults.hits === 'undefined') {
            var error = document.createElement('p')
            error.innerHTML = searchResults
            container.appendChild(error)
        // Check if there are hits and max_score is more than 0 
        // Max score is checked as well as filter will always return something
        } else if (searchResults.hits.hits.length === 0 || searchResults.hits['max_score'] === 0) {
            var error = generateErrorHTML()
            container.appendChild(error)
        } else {
            searchResults.hits.hits.forEach(function(result, i) {
                var formatted = formatResult(result, i)
                var element = generateResultHTML(formatted)
                container.appendChild(element)
            });
            highlightBody()
        }
    }

    var generateErrorHTML = function() {
        var error = document.createElement('p')
        error.innerHTML = 'Results matching your query were not found.'
        error.classList.add('not-found')
        return error
    }

    var generateResultHTML = function(result, i) {
        var element = document.createElement('a')
        element.className = 'search-link nav-link'
        var urlParts = ('{{site.baseurl}}' + result.url).split('/')
        urlParts = urlParts.filter(function(part) {
            return part !== ''
        })
        element.href = '/' + urlParts.join('/')
        var elementLeft = document.createElement('div')
        elementLeft.className = 'left'
        // Document title
        elementLeft.innerHTML = result.documentTitle || '{{ site.title }}'
        var elementRight = document.createElement('div')
        elementRight.className = 'right'
        var header = document.createElement('p')
        header.className = 'search-header'
        header.innerHTML = result.title
        elementRight.appendChild(header)
        var content = document.createElement('p')
        content.className = 'search-content'
        content.innerHTML = result.content
        elementRight.appendChild(content)
        element.onmouseup = function() {
            return trackSearch(searchBoxElement.value.trim(), i, false)
        }
        element.appendChild(elementLeft)
        element.appendChild(elementRight)
        return element
    }

    formatResult = function(result) {
        var content = null
        var title = result._source.title
        var regex = /<mark>(.*?)<\/mark>/g
        var joinHighlights = function(str) {
            if (str) {
                return str.replace(/<\/mark> <mark>/g, ' ')
            }
        }
        if (result.highlight) {
            ['title', 'content'].forEach(function(field) {
                var curr, match, results1, term;
                if (result.highlight[field]) {
                    var curr = result.highlight[field].join('...')
                    var curr = curr.trimLeft()
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
        }
        if (result.highlight.content) {
            content = joinHighlights(result.highlight.content.slice(0, Math.min(3, result.highlight.content.length)).join('...'))
        }
        if (result.highlight.title) {
            title = joinHighlights(result.highlight.title[0])
        }
        var url = result._source.url;
        var documentTitle = result._source.documentTitle;
        return {
            url: url,
            content: '...' + content + '...',
            title: title,
            documentTitle: documentTitle
        }
    }

    var debounce = function(func, threshold, execAsap) {
        var timeout = null;
        return function() {
            var args = 1 <= arguments.length ? slice.call(arguments, 0) : []
            obj = this
            var delayed = function() {
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


    var createEsQuery = function(queryStr) {
        var source = ['title', 'url', 'documentTitle']
        var title_automcomplete_q = {
            'match_phrase_prefix': {
                'title': {
                'query': queryStr,
                'max_expansions': 20,
                'boost': 40,
                'slop': 10
                }
            }
        }
        var content_automcomplete_q = {
        'match_phrase_prefix': {
            'content': {
            'query': queryStr,
            'max_expansions': 20,
            'boost': 30,
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
        if (page && page.documentInfo[0]) {
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
    esSearch = function(query) {
        var req = new XMLHttpRequest();
        req.addEventListener('readystatechange', function() {
            if (req.readyState === 4) {
                var successResultCodes = [200, 304]
                if (successResultCodes.includes(req.status)) {
                var result = JSON.parse(req.responseText)
                if (typeof result.error === 'undefined') {
                    return renderSearchResultsFromServer(result.body)
                } else {
                    return renderSearchResultsFromServer(result.error)
                }
                } else {
                return renderSearchResultsFromServer('Error retrieving search results ...')
                }
            }
        })
        var esQuery = createEsQuery(query)
        req.open('POST', search_endpoint, true)
        req.setRequestHeader('Content-Type', 'application/json')
        req.setRequestHeader('X-Requested-With', 'XMLHttpRequest')
        req.send(JSON.stringify(esQuery))
    }

    var lunrSearch = function(query) {
        // https://lunrjs.com/guides/searching.html
        // Add wildcard before and after
        var queryTerm = '*' + query + '*'
        var lunrResults = lunrIndex.search(queryTerm)
        var results = translateLunrResults(lunrResults)
        highlightBody()
        renderSearchResults(results)
    }

    // Enable the searchbox once the index is built
    var enableSearchBox = function() {
        searchBoxElement.removeAttribute('disabled')
        searchBoxElement.classList.remove('loading')
        searchBoxElement.setAttribute('placeholder', 'Search document')
        searchBoxElement.addEventListener('input', function(e) {
            if (e.target.value === '') {
                onSearchChange()
            } else {
                onSearchChangeDebounced()
            }
        })
    }

    var onSearchChange = function() {
        var searchResults = document.getElementsByClassName('search-results')[0]
        var query = searchBoxElement.value.trim()
        // Clear highlights
        wordsToHighlight = []
        if (query.length < minQueryLength) {
            searchResults.style.display = 'none'
            highlightBody()
        } else {
            searchResults.style.display = 'block'
            if (searchOnServer) {
                esSearch(query)
            } else {
                lunrSearch(query)
            }
        }
    }

    var onSearchChangeDebounced = debounce(onSearchChange, 500, false)

    searchIndexPromise.then(function() {
        enableSearchBox()
    })

    searchBoxElement.onkeyup = function(e) {
        if (e.keyCode === 13) {
            var container = document.getElementsByClassName('search-results')[0]
            container.style.opacity = 0
            return setTimeout(function() {
                return container.style.opacity = 1
            }, 100)
        }
    }

    // Highlighting
    // ============================================================================
    window.highlightBody = function() {
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