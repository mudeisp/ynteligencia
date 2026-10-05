const CACHE_NAME = "ynteligencia-v2";

const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png"
];


/* =========================================================
   INSTALL
========================================================= */

self.addEventListener("install", event => {

  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(cache =>
        cache.addAll(STATIC_ASSETS)
      )
  );

  self.skipWaiting();

});


/* =========================================================
   ACTIVATE
========================================================= */

self.addEventListener("activate", event => {

  event.waitUntil(

    caches
      .keys()
      .then(names =>

        Promise.all(

          names
            .filter(
              name =>
                name !== CACHE_NAME
            )
            .map(
              name =>
                caches.delete(name)
            )

        )

      )

  );

  self.clients.claim();

});


/* =========================================================
   FETCH
========================================================= */

self.addEventListener("fetch", event => {

  const request =
    event.request;

  const url =
    new URL(
      request.url
    );


  /*
    Somente GET.
  */
  if (
    request.method !== "GET"
  ) {
    return;
  }


  /*
    APIs nunca passam pelo cache da PWA.
  */
  if (
    url.pathname.startsWith(
      "/api/"
    )
  ) {
    return;
  }


  /*
    CRÍTICO:
    deixa o worker e os arquivos do OneSignal
    completamente fora da lógica deste SW.
  */
  if (
    url.pathname.startsWith(
      "/onesignal/"
    )
  ) {
    return;
  }


  /*
    Não intercepta recursos externos.
  */
  if (
    url.origin !==
    self.location.origin
  ) {
    return;
  }


  event.respondWith(

    fetch(request)

      .then(response => {

        /*
          Só armazena resposta válida.
        */
        if (
          response &&
          response.ok
        ) {

          const clone =
            response.clone();

          caches
            .open(CACHE_NAME)
            .then(cache => {

              cache.put(
                request,
                clone
              );

            })
            .catch(() => {});

        }

        return response;

      })


      .catch(async () => {

        /*
          Primeiro tenta exatamente o recurso solicitado.
        */
        const cached =
          await caches.match(
            request
          );

        if (cached) {
          return cached;
        }


        /*
          Se for navegação do app,
          entrega o index como fallback.
        */
        if (
          request.mode ===
          "navigate"
        ) {

          const index =
            await caches.match(
              "/index.html"
            );

          if (index) {
            return index;
          }

        }


        /*
          IMPORTANTE:
          nunca devolver undefined.
          respondWith precisa receber Response.
        */
        return new Response(
          "Offline",
          {
            status: 503,
            statusText:
              "Service Unavailable",

            headers: {
              "Content-Type":
                "text/plain; charset=utf-8"
            }
          }
        );

      })

  );

});
