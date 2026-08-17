#!/usr/bin/env python3
"""
publish-daily-batch.py — Publish ~19 pending articles per run (balanced across sections).
Runs daily at 05:50 via cron, before the 06:00 digest.
"""
import subprocess, os, json, sys
from datetime import datetime

DAILY_TARGET = 19  # articles per day
MAX_DAYS = 7       # total days to spread

def run_sql(sql):
    r = subprocess.run(
        ["docker", "exec", "science_agent_db", "psql", "-U", "postgres", "-d", "science_agent",
         "-t", "-A", "-F", "|", "-c", sql],
        capture_output=True, text=True, timeout=30
    )
    return r.stdout.strip()

# Count pending by section
pending = {}
for line in run_sql("SELECT section, COUNT(*) FROM news WHERE status='pending' GROUP BY section;").split("\n"):
    if "|" in line:
        sec, cnt = line.split("|")
        pending[sec.strip()] = int(cnt.strip())

total_pending = sum(pending.values())
if total_pending == 0:
    print("[publisher] No pending articles — nothing to publish")
    sys.exit(0)

# Calculate today's batch (balanced across sections)
today = datetime.now().strftime("%Y-%m-%d")
print(f"[publisher] {total_pending} pending total, target {DAILY_TARGET}/day")

# Get article IDs to publish (balanced: proportional to each section's share)
ids_to_publish = []
for section, count in pending.items():
    if count == 0:
        continue
    # Take proportional share, at least 1 if section has articles
    share = max(1, round(DAILY_TARGET * count / total_pending))
    share = min(share, count)  # don't exceed what's available
    ids = run_sql(
        f"SELECT id FROM news WHERE status='pending' AND section='{section}' "
        f"ORDER BY id LIMIT {share};"
    )
    for line in ids.split("\n"):
        if line.strip().isdigit():
            ids_to_publish.append(int(line.strip()))

# Trim to DAILY_TARGET
ids_to_publish = ids_to_publish[:DAILY_TARGET]

if not ids_to_publish:
    print("[publisher] No articles selected")
    sys.exit(0)

# Publish them
id_list = ",".join(str(i) for i in ids_to_publish)
run_sql(
    f"UPDATE news SET status='published', \"updatedAt\"=NOW() WHERE id IN ({id_list});"
)

# Count by section what we just published
result = run_sql(
    f"SELECT section, COUNT(*) FROM news WHERE id IN ({id_list}) GROUP BY section;"
)
print(f"[publisher] Published {len(ids_to_publish)} articles: {result}")
print(f"[publisher] IDs: {id_list}")

# Check remaining
remaining = {}
for line in run_sql("SELECT section, COUNT(*) FROM news WHERE status='pending' GROUP BY section;").split("\n"):
    if "|" in line:
        sec, cnt = line.split("|")
        remaining[sec.strip()] = int(cnt.strip())
total_remaining = sum(remaining.values())
print(f"[publisher] Remaining: {total_remaining} ({remaining})")
if total_remaining == 0:
    print("[publisher] All articles published — auto-posting complete!")
