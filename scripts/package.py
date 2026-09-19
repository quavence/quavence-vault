import os
import shutil
import zipfile
import hashlib

import json

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST_DIR = os.path.join(BASE_DIR, 'dist')

with open(os.path.join(BASE_DIR, 'package.json'), 'r', encoding='utf-8') as pf:
    pkg_ver = json.load(pf).get('version', '0.1.1')

ZIP_NAME = f'quavence-vault-extension-v{pkg_ver}.zip'
ZIP_PATH = os.path.join(BASE_DIR, ZIP_NAME)
SHA_PATH = f'{ZIP_PATH}.sha256'

PUBLIC_DOWNLOADS = os.path.normpath(
    os.path.join(BASE_DIR, '..', 'quavence_app', 'public', 'downloads', 'vault')
)

def main():
    print(f'[Package] Building standard zip from {DIST_DIR}...')
    if not os.path.exists(DIST_DIR):
        raise RuntimeError(f'Directory {DIST_DIR} does not exist. Run build first!')

    # Build zip with POSIX forward slashes
    with zipfile.ZipFile(ZIP_PATH, 'w', zipfile.ZIP_DEFLATED) as zf:
        for root, _, files in os.walk(DIST_DIR):
            for file in files:
                full_path = os.path.join(root, file)
                # Ensure forward slashes for cross-platform Linux/Mac/Win compatibility
                rel_path = os.path.relpath(full_path, DIST_DIR).replace('\\', '/')
                zf.write(full_path, rel_path)

    # Compute SHA-256
    with open(ZIP_PATH, 'rb') as f:
        sha256 = hashlib.sha256(f.read()).hexdigest()

    sha_content = f'{sha256}  {ZIP_NAME}\n'
    with open(SHA_PATH, 'w') as f:
        f.write(sha_content)

    print(f'[Package] Created {ZIP_NAME}')
    print(f'[Package] SHA256: {sha256}')

    # Copy to quavence_app public downloads if exists
    if os.path.exists(PUBLIC_DOWNLOADS):
        dest_versioned = os.path.join(PUBLIC_DOWNLOADS, ZIP_NAME)
        dest_latest = os.path.join(PUBLIC_DOWNLOADS, 'quavence-vault-latest.zip')
        dest_sha = os.path.join(PUBLIC_DOWNLOADS, f'{ZIP_NAME}.sha256')
        dest_latest_sha = os.path.join(PUBLIC_DOWNLOADS, 'quavence-vault-latest.zip.sha256')

        shutil.copyfile(ZIP_PATH, dest_versioned)
        shutil.copyfile(ZIP_PATH, dest_latest)
        shutil.copyfile(SHA_PATH, dest_sha)
        with open(dest_latest_sha, 'w') as f:
            f.write(f'{sha256}  quavence-vault-latest.zip\n')

        dest_sums = os.path.join(PUBLIC_DOWNLOADS, 'SHA256SUMS.txt')
        sums_entries = {}
        if os.path.exists(dest_sums):
            with open(dest_sums, 'r', encoding='utf-8') as sf:
                for line in sf:
                    parts = line.strip().split(None, 1)
                    if len(parts) == 2:
                        sums_entries[parts[1]] = parts[0]

        sums_entries['quavence-vault-latest.zip'] = sha256
        sums_entries[ZIP_NAME] = sha256

        # Order: latest first, current version second, then other versions
        ordered_keys = ['quavence-vault-latest.zip', ZIP_NAME]
        for k in sorted(sums_entries.keys(), reverse=True):
            if k not in ordered_keys:
                ordered_keys.append(k)

        with open(dest_sums, 'w', encoding='utf-8') as sf:
            for name in ordered_keys:
                if name in sums_entries:
                    sf.write(f'{sums_entries[name]}  {name}\n')

        # Also write SHA256SUMS.txt in BASE_DIR for repo consistency
        base_sums = os.path.join(BASE_DIR, 'SHA256SUMS.txt')
        shutil.copyfile(dest_sums, base_sums)

        print(f'[Package] Synchronized to {PUBLIC_DOWNLOADS} and updated SHA256SUMS.txt')

if __name__ == '__main__':
    main()
