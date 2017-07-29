mkdir -p build
rm -f build/chrome-runtime.zip
pushd chrome
zip -ry ../build/chrome-runtime.zip . -x *.git*
