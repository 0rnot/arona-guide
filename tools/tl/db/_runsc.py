"""`scorecmp.py` を `tl-work` の作業場で回す（この会話は `arona-guide` から出られない）。"""
import os
import subprocess
import sys

os.chdir('/home/pebkac/arona/tl-work')
sys.exit(subprocess.run(['/home/pebkac/arona/tl-work/venv/bin/python', 'scorecmp.py']
                        + sys.argv[1:], check=False).returncode)
