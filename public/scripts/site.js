(() => {
  "use strict";
  if (location.hostname.endsWith(".onion")) document.documentElement.classList.add("onion-access");
})();
