(function () {
    if (location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
        var count = document.createElement("script");
        count.async = true;
        count.src = "https://gc.zgo.at/count.js";
        count.setAttribute("data-goatcounter", "https://itdesigns-kruft.goatcounter.com/count");
        document.head.appendChild(count);
    }

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

    var form = document.getElementById("kontaktformular");
    if (form) {
        var params = new URLSearchParams(window.location.search);
        var thema = params.get("thema");
        var subject = document.getElementById("kontakt-betreff");
        var status = document.getElementById("kontakt-status");

        if (thema && subject) {
            subject.value = "Kontaktanfrage: " + thema + " – it-designs.de";
        }

        if (params.get("gesendet") === "1" && status) {
            status.textContent = "Danke, Ihre Nachricht ist angekommen. Ich melde mich.";
            status.classList.add("is-success");
            form.querySelectorAll("input, textarea, button").forEach(function (field) {
                if (field.type !== "hidden") {
                    field.disabled = true;
                }
            });
        }

        form.addEventListener("submit", function (event) {
            var email = (document.getElementById("kontakt-email") || {}).value || "";
            var phone = (document.getElementById("kontakt-telefon") || {}).value || "";
            if (!email.trim() && !phone.trim()) {
                event.preventDefault();
                if (status) {
                    status.textContent = "Bitte E-Mail oder Telefon angeben, damit ich antworten kann.";
                    status.classList.remove("is-success");
                    status.classList.add("is-error");
                }
            }
        });
    }
})();
