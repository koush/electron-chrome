function numberParts(v) {
  var ret = v.split('.', 4)
  .map(p => parseInt(p));

  while (ret.length < 4)
    ret.push(0);
  return ret;
}

function compare(v1, v2) {
  v1 = numberParts(v1);
  v2 = numberParts(v2);

  for (var i = 0; i < Math.min(v1.length, v2.length); i++) {
    if (v2[i] > v1[i])
      return -1;
    if (v1[i] > v2[i])
      return 1;
  }
  return 0;
}

function isUpgrade(v1, v2) {
  return compare(v1, v2) < 0;
}

exports.isUpgrade = isUpgrade;
exports.compare = compare;
