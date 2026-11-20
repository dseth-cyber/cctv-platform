#!/bin/sh
# Builds the package to hand out: a .zip and a .tar.gz of one release tag, without the first site's internal notes
# (see export-ignore in .gitattributes), with a VERSION file so install/update scripts know the release.
#   sh scripts/make-release.sh v1.0.0-rc14        -> dist/cctv-platform-1.0.0-rc14.zip / .tar.gz
set -eu
cd "$(dirname "$0")/.."
TAG=${1:?usage: sh scripts/make-release.sh <tag>}
git rev-parse -q --verify "refs/tags/$TAG" >/dev/null || { echo "no tag $TAG"; exit 1; }
V=${TAG#v}; NAME=cctv-platform-$V
mkdir -p dist
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
git archive --format=tar --prefix="$NAME/" "$TAG" | tar -x -C "$TMP"
echo "$V" > "$TMP/$NAME/VERSION"
# Nothing secret may leave: stop if a settings file or key slipped into the tree.
if find "$TMP/$NAME" \( -name '.env' -o -name '.env.production' -o -name '*.key' -o -name '*.pem' \) | grep -q .; then
  echo "STOP: a settings file or key is in the package"; exit 1
fi
( cd "$TMP" && tar -czf "$OLDPWD/dist/$NAME.tar.gz" "$NAME" )
if command -v zip >/dev/null; then ( cd "$TMP" && zip -qr "$OLDPWD/dist/$NAME.zip" "$NAME" ); else
  ( cd "$TMP" && python3 -c "import shutil,sys; shutil.make_archive(sys.argv[1], 'zip', '.', sys.argv[2])" "$OLDPWD/dist/$NAME" "$NAME" ); fi
ls -la dist/"$NAME".*
