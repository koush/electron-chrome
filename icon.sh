echo "creating icon from $1"
cd build

# Linux
mkdir -p build
cp $1 build/icon.png

# Mac
mkdir icon.iconset
sips -z 16 16     $1 --out icon.iconset/icon_16x16.png
sips -z 32 32     $1 --out icon.iconset/icon_16x16@2x.png
sips -z 32 32     $1 --out icon.iconset/icon_32x32.png
sips -z 64 64     $1 --out icon.iconset/icon_32x32@2x.png
sips -z 128 128   $1 --out icon.iconset/icon_128x128.png
sips -z 256 256   $1 --out icon.iconset/icon_128x128@2x.png
sips -z 256 256   $1 --out icon.iconset/icon_256x256.png
sips -z 512 512   $1 --out icon.iconset/icon_256x256@2x.png
sips -z 512 512   $1 --out icon.iconset/icon_512x512.png
sips -z 1024 1024   $1 --out icon.iconset/icon_512x512@2x.png
iconutil -c icns icon.iconset
# rm -R icon.iconset
