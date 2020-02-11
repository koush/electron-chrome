echo "creating icon from %1"
cd build

magick %1 -define icon:auto-resize=256,128,64,48,32,16 icon.ico
