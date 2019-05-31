#!/bin/bash

echo 'Generating PDFs'
echo 'Installing node dependencies'
npm i html-pdf glob jsdom js-yaml semaphore
node _site/assets/startup/pdfgen-parent.js
echo 'Generating PDFs Complete'
