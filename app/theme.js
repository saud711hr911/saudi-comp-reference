// Applies the saved light/dark choice before first paint (kept out of inline script for the content security policy).
try { var t = localStorage.getItem("saudi-ref-theme"); if (t) document.documentElement.setAttribute("data-theme", t); } catch (e) { }
