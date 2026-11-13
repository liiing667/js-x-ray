const r = require;

function bootstrap() {
  r("not-a-dependency");
  var r = "local";
  r("also-not-a-dependency");
}

function load() {
  r("fs");
}
