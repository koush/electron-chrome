cd $(dirname $0)

rm -rf build/
mkdir build
node package.js $@
if [ $? != 0 ]
then
  exit $?
fi

pushd chrome
zip -ry ../build/chrome-runtime.zip . > /dev/null
popd

pushd build/*darwin*
zip -ry $(ls | grep \\.app | sed s/.app//)'-mac.zip' *.app > /dev/null
popd
