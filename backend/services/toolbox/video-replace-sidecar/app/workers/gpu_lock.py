"""Global asyncio lock — one replacement pipeline runs at a time.

Detection and replacement use separate locks so a fresh detection request
does not have to wait for an in-progress replacement job.
"""
import asyncio

# Acquired by the ReplaceRunner for the full tracking→replacing pipeline.
# Mirrors the _detect_lock pattern in the router.
replace_lock = asyncio.Lock()
