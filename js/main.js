(function () {
    var toggle = document.querySelector(".nav-toggle");
    var nav = document.querySelector("header nav");

    if (!toggle || !nav) {
        return;
    }

    function closeNav() {
        nav.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
    }

    toggle.addEventListener("click", function () {
        var open = nav.classList.toggle("is-open");
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });

    nav.querySelectorAll("a").forEach(function (link) {
        link.addEventListener("click", closeNav);
    });

    document.addEventListener("keydown", function (event) {
        if (event.key === "Escape") {
            closeNav();
        }
    });
})();
