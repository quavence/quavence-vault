import os
import shutil
import zipfile
import hashlib

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST_DIR = os.path.join(BASE_DIR, 'dist')
ZIP_NAME = 'quavence-vault-extension-v0.1.0.zip'
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

        shutil.copyfile(ZIP_PATH, dest_versioned)
        shutil.copyfile(ZIP_PATH, dest_latest)
        shutil.copyfile(SHA_PATH, dest_sha)
        print(f'[Package] Synchronized to {PUBLIC_DOWNLOADS}')

if __name__ == '__main__':
    main()
