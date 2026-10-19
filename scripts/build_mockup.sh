#!/bin/sh
# Wrap the artifact-style mockup (no <head>/<body>) into a standalone page served at /CzechMate/mockup/.
cd "$(dirname "$0")/.."
src=mockup-src/czechmate-mockup.html
out=public/mockup/index.html
mkdir -p public/mockup
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
sed -n '1,/^<\/style>$/p' "$src"
echo '</head>'
echo '<body>'
sed '1,/^<\/style>$/d' "$src"
echo '</body>'
echo '</html>'
} > "$out"
