#!/usr/bin/env bash
# 生成无字卡面：incoming/guangqi-{front,back} + public/gate/*.webp（原图先备份到 scripts/gq/orig/gate）→ /tmp/gq/clean/<key>.png
set -e; cd "$(dirname "$0")/../.."; mkdir -p /tmp/gq/clean scripts/gq/orig/gate
for f in first_light growth resonance; do [ -f scripts/gq/orig/gate/$f.webp ] || cp public/gate/$f.webp scripts/gq/orig/gate/; done
for s in front back; do for n in 01 02 03 04 05 06 07 08 09 10; do python3 scripts/gq/detext.py incoming/guangqi-$s/$s-$n.jpg $s-$n /tmp/gq/clean/$s-$n.png; done; done
for f in first_light growth resonance; do python3 scripts/gq/detext.py scripts/gq/orig/gate/$f.webp gate-$f /tmp/gq/clean/gate-$f.png; done
