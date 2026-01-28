#!/usr/bin/env bash
set -euo pipefail

# Optional: where your .dot files live (default: current directory)
DOT_DIR="."
# Optional: where to put the .svg outputs (your site expects ./img/*.svg)
OUT_DIR="./img"

mkdir -p "$OUT_DIR"

domains=(
  "facebook.com"
  "youtube.com"
  "instagram.com"
  "x.com"
  "linkedin.com"
  "github.com"
  "tiktok.com"
  "vimeo.com"
  "wordpress.com"
  "reddit.com"
  "tumblr.com"
  "medium.com"
  "soundcloud.com"
  "theguardian.com"
  "forbes.com"
  "washingtonpost.com"
  "dailymail.co.uk"
  "qr.ae"
  "foxnews.com"
  "news.ycombinator.com"
  "humblequilts.blogspot.com"
  "stackoverflow.com"
  "nypost.com"
  "substack.com"
  "theverge.com"
  "math.stackexchange.com"
  "arstechnica.com"
  "slashdot.org"
  "douban.com"
  "dev.to"
  "producthunt.com"
  "blog.comebacks.app"
  "edstem.org"
  "ratemyprofessors.com"
  "jiji.com.gh"
  "jumia.com.gh"
  "chuckdries.com"
  "allbloggingtips.com"
  "aristath.github.io"
  "discord.com"
  "twitch.tv"
  "weibo.com"
  "tripadvisor.com"
  "the-boys.fandom.com"
  "bilibili.com"
  "trustpilot.com"
  "yelp.com"
  "threads.com"
  "bilibili.tv"
  "glassdoor.com"
  "m.weibo.cn"
  "capterra.com"
  "support.google.com"
  "moz.com"
  "webmasters.stackexchange.com"
  "tripadvisor.co.uk"
  "superuser.com"
  "glassdoor.co.in"
  "askubuntu.com"
  "serverfault.com"
  "yelp.ca"
  "stackoverflow.blog"
  "forum.vbulletin.com"
  "bbpress.org"
  "caddy.community"
  "boards.ie"
  "mathoverflow.net"
  "fmmvibe.com"
  "monopolygo.wiki"
  "nothing.community"
  "forum.ge"
  "blender.community"
  "vegasmessageboard.com"
  "forums.rs"
)

missing=0

for domain in "${domains[@]}"; do
  dot_file="${DOT_DIR}/${domain}.dot"
  out_file="${OUT_DIR}/${domain}.svg"

  if [[ ! -f "$dot_file" ]]; then
    echo "MISSING: $dot_file"
    missing=$((missing + 1))
    continue
  fi

  echo "Generating: $out_file"
  dot -Tsvg "$dot_file" -o "$out_file"
done

echo "Done. Missing .dot files: $missing"
