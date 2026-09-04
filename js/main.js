(function () {
    var toggle = document.querySelector(".nav-toggle");
    var nav = document.querySelector("header nav");

    function closeNav() {
        if (!nav || !toggle) {
            return;
        }
        nav.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
    }

    if (toggle && nav) {
        toggle.addEventListener("click", function () {
            var open = nav.classList.toggle("is-open");
            toggle.setAttribute("aria-expanded", open ? "true" : "false");
        });

        nav.querySelectorAll("a").forEach(function (link) {
            link.addEventListener("click", closeNav);
        });
    }

    var lightbox = document.querySelector("[data-lightbox-overlay]");
    var lightboxImage = lightbox && lightbox.querySelector("img");
    var lightboxCaption = lightbox && lightbox.querySelector("[data-lightbox-caption]");

    function closeLightbox() {
        if (!lightbox) {
            return;
        }
        lightbox.hidden = true;
        document.body.style.overflow = "";
    }

    document.querySelectorAll("[data-lightbox]").forEach(function (button) {
        button.addEventListener("click", function () {
            if (!lightbox || !lightboxImage) {
                return;
            }
            var image = button.querySelector("img");
            lightboxImage.src = button.getAttribute("data-full") || image.src;
            lightboxImage.alt = image.alt;
            if (lightboxCaption) {
                lightboxCaption.textContent = button.getAttribute("data-caption") || "";
            }
            lightbox.hidden = false;
            document.body.style.overflow = "hidden";
        });
    });

    if (lightbox) {
        lightbox.addEventListener("click", function (event) {
            if (event.target === lightbox || event.target.closest("[data-lightbox-close]")) {
                closeLightbox();
            }
        });
    }

    document.addEventListener("keydown", function (event) {
        if (event.key === "Escape") {
            closeNav();
            closeLightbox();
        }
    });
})();
