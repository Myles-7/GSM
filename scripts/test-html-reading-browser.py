"""Compatibility entry point for the current standalone reader browser regression.

The old 4178 default remains available; override GSM_READING_TEST_URL when using
another disposable Vite server. No real account, mail or model calls are used.
"""
import os
import runpy
from pathlib import Path

os.environ.setdefault('GSM_READING_TEST_URL', 'http://127.0.0.1:4178')
runpy.run_path(str(Path(__file__).with_name('test-html-reading-redesign.py')), run_name='__main__')
