function throttleTimeout(token, item, throttle, cb) {
  if (!token)
    token = { items:[] };
  token.items.push(item);
  if (!token.timeout) {
    token.timeout = setTimeout(function() {
      delete token.timeout;
      cb(token.items);
      token.items = [];
    }, throttle);
  }
  return token;
}

exports.throttleTimeout = throttleTimeout;
