#!/bin/sh
# Wrap the artifact-style mockup (no <head>/<body>) into a standalone page for GitHub Pages.
cd "$(dirname "$0")"
{
cat <<'HEAD'
<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="CzechMate">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px);color-scheme:light}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>
HEAD
sed -n '1,/^<\/style>$/p' czechmate-mockup.html
echo '</head>'
echo '<body>'
sed '1,/^<\/style>$/d' czechmate-mockup.html
echo '</body>'
echo '</html>'
} > index.html
