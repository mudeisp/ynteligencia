const SUPABASE_URL = "https://wzaegidwtdjuhqchpdpd.supabase.co";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed"
    });
  }

  res.setHeader("Cache-Control", "no-store");

  // =========================================================
  // PAINEL AUTOMÁTICO DE CARGA
  // =========================================================
  //
  // Abrir /api/orulo-sync sem ?page= devolve esta página.
  // O navegador chama cada lote separadamente:
  //   /api/orulo-sync?page=1
  //   /api/orulo-sync?page=2
  //   ...
  //
  // Assim cada lote ganha uma nova invocação da Vercel e não
  // estoura o timeout da carga completa.
  // =========================================================

  if (!req.query?.page) {
    res.setHeader(
      "Content-Type",
      "text/html; charset=utf-8"
    );

    return res.status(200).send(`<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Carga Órulo</title>
<style>
  *{box-sizing:border-box}

  body{
    margin:0;
    min-height:100vh;
    display:grid;
    place-items:center;
    padding:24px;
    background:#111;
    color:#f7f4ed;
    font-family:Arial,sans-serif;
  }

  .card{
    width:min(760px,100%);
    padding:28px;
    border:1px solid #3a362f;
    border-radius:18px;
    background:#1b1a18;
    box-shadow:0 20px 60px rgba(0,0,0,.35);
  }

  h1{
    margin:0 0 8px;
    font-size:26px;
  }

  p{
    color:#c9c1b5;
    line-height:1.55;
  }

  .bar{
    height:12px;
    overflow:hidden;
    margin:24px 0 14px;
    border-radius:999px;
    background:#2a2824;
  }

  .bar span{
    display:block;
    width:0%;
    height:100%;
    background:#c6a76b;
    transition:width .25s ease;
  }

  .status{
    font-weight:700;
    margin-bottom:14px;
  }

  .stats{
    display:grid;
    grid-template-columns:repeat(3,1fr);
    gap:10px;
    margin:18px 0;
  }

  .stat{
    padding:14px;
    border:1px solid #37332d;
    border-radius:12px;
    background:#151412;
  }

  .stat strong{
    display:block;
    font-size:22px;
  }

  .stat span{
    font-size:12px;
    color:#aaa197;
  }

  pre{
    max-height:310px;
    overflow:auto;
    margin:18px 0 0;
    padding:14px;
    border-radius:12px;
    background:#0d0d0c;
    color:#d8d1c5;
    font-size:12px;
    line-height:1.5;
    white-space:pre-wrap;
  }

  button{
    min-height:44px;
    padding:0 16px;
    border:0;
    border-radius:10px;
    font-weight:800;
    cursor:pointer;
    background:#e4d0a3;
    color:#302a22;
  }

  button:disabled{
    opacity:.55;
    cursor:wait;
  }

  @media(max-width:640px){
    .stats{
      grid-template-columns:1fr;
    }
  }
</style>
</head>

<body>

<div class="card">

  <h1>Carga inicial Órulo</h1>

  <p>
    A carga será processada em lotes seguros.
    Não feche esta aba até aparecer
    <strong>CARGA CONCLUÍDA</strong>.
  </p>

  <button id="start">
    INICIAR CARGA
  </button>

  <div class="bar">
    <span id="bar"></span>
  </div>

  <div class="status" id="status">
    Aguardando início.
  </div>

  <div class="stats">

    <div class="stat">
      <strong id="pages">0</strong>
      <span>páginas concluídas</span>
    </div>

    <div class="stat">
      <strong id="buildings">0</strong>
      <span>empreendimentos recebidos</span>
    </div>

    <div class="stat">
      <strong id="properties">0</strong>
      <span>propriedades salvas</span>
    </div>

  </div>

  <pre id="log"></pre>

</div>

<script>
(() => {

  const startBtn =
    document.getElementById("start");

  const statusEl =
    document.getElementById("status");

  const barEl =
    document.getElementById("bar");

  const pagesEl =
    document.getElementById("pages");

  const buildingsEl =
    document.getElementById("buildings");

  const propertiesEl =
    document.getElementById("properties");

  const logEl =
    document.getElementById("log");

  let running = false;


  function appendLog(text){
    logEl.textContent += text + "\\n";
    logEl.scrollTop = logEl.scrollHeight;
  }


  async function run(){

    if(running) return;

    running = true;

    startBtn.disabled = true;

    let page = 1;

    let completedPages = 0;

    let totalPages = null;

    let totalBuildings = 0;

    let totalProperties = 0;


    statusEl.textContent =
      "Iniciando carga...";

    appendLog(
      "Início da carga."
    );


    try{

      while(true){

        statusEl.textContent =
          totalPages
            ? "Processando página " +
              page +
              " de " +
              totalPages +
              "..."
            : "Processando página " +
              page +
              "...";


        const response =
          await fetch(
            "/api/orulo-sync?page=" + page,
            {
              method:"GET",
              cache:"no-store"
            }
          );


        const data =
          await response.json();


        if(
          !response.ok ||
          data.ok !== true
        ){

          throw new Error(
            data.error ||
            (
              "Falha HTTP " +
              response.status
            )
          );

        }


        completedPages++;


        totalBuildings +=
          Number(
            data.buildings_received || 0
          );


        totalProperties +=
          Number(
            data.properties_saved || 0
          );


        if(
          data.total_pages_detected
        ){

          totalPages =
            Number(
              data.total_pages_detected
            );

        }


        pagesEl.textContent =
          completedPages;


        buildingsEl.textContent =
          totalBuildings;


        propertiesEl.textContent =
          totalProperties;


        if(totalPages){

          const pct =
            Math.min(
              100,
              Math.round(
                (page / totalPages) * 100
              )
            );

          barEl.style.width =
            pct + "%";

        }


        appendLog(
          "Página " +
          page +
          " | prédios: " +
          (
            data.buildings_received || 0
          ) +
          " | residenciais: " +
          (
            data.residential_buildings || 0
          ) +
          " | properties: " +
          (
            data.properties_saved || 0
          )
        );


        if(
          data.done === true ||
          !data.next_page
        ){

          barEl.style.width =
            "100%";

          statusEl.textContent =
            "CARGA CONCLUÍDA";

          appendLog(
            "Carga concluída com sucesso."
          );

          break;
        }


        page =
          Number(
            data.next_page
          );

      }

    }catch(error){

      console.error(error);

      statusEl.textContent =
        "ERRO NA CARGA — veja o log abaixo.";

      appendLog(
        "ERRO: " +
        (
          error?.message ||
          String(error)
        )
      );

      startBtn.disabled =
        false;

      startBtn.textContent =
        "TENTAR NOVAMENTE";

      running =
        false;

      return;
    }


    running =
      false;

    startBtn.textContent =
      "CARGA CONCLUÍDA";

  }


  startBtn.addEventListener(
    "click",
    run
  );

})();
</script>

</body>
</html>`);
  }


  try {

    const oruloClientId =
      process.env.ORULO_CLIENT_ID;

    const oruloClientSecret =
      process.env.ORULO_CLIENT_SECRET;

    const supabaseSecretKey =
      process.env.SUPABASE_SECRET_KEY;


    if (
      !oruloClientId ||
      !oruloClientSecret ||
      !supabaseSecretKey
    ) {

      return res.status(500).json({
        ok: false,
        error:
          "Variáveis de ambiente ausentes"
      });

    }


    // =========================================================
    // 1. AUTENTICAÇÃO ÓRULO
    // =========================================================

    const tokenResponse =
      await fetch(
        "https://www.orulo.com.br/oauth/token",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/x-www-form-urlencoded"
          },

          body:
            new URLSearchParams({
              client_id:
                oruloClientId,

              client_secret:
                oruloClientSecret,

              grant_type:
                "client_credentials"
            }).toString()
        }
      );


    const tokenData =
      await tokenResponse.json();


    if (
      !tokenResponse.ok ||
      !tokenData.access_token
    ) {

      return res.status(502).json({
        ok: false,
        error:
          "Falha na autenticação com a Órulo"
      });

    }


    const accessToken =
      tokenData.access_token;


    const oruloHeaders = {
      Authorization:
        \`Bearer \${accessToken}\`,

      Accept:
        "application/json"
    };


    // =========================================================
    // 2. BUSCA EMPREENDIMENTOS — CARGA EM LOTES
    // =========================================================
    //
    // A carga completa da Órulo pode conter centenas de prédios.
    // Processar tudo em uma única invocação estoura o tempo da
    // função na Vercel.
    //
    // Por isso cada chamada processa SOMENTE uma página.
    //
    // Exemplo:
    //
    // /api/orulo-sync?page=1
    // /api/orulo-sync?page=2
    // /api/orulo-sync?page=3
    //
    // O painel acima faz isso automaticamente.
    //
    // IMPORTANTE:
    //
    // - NÃO desativamos todo source=novos a cada lote.
    // - Cada página apenas cria/atualiza os registros recebidos.
    // - O webhook continua mantendo as alterações posteriores.
    //
    // =========================================================


    const RESULTS_PER_PAGE =
      10;


    const requestedPage =
      Math.max(
        1,
        Number(
          req.query?.page || 1
        ) || 1
      );


    const params =
      new URLSearchParams({
        state:
          "SP",

        city:
          "São Paulo",

        results_per_page:
          String(
            RESULTS_PER_PAGE
          ),

        page:
          String(
            requestedPage
          )
      });


    const buildingsResponse =
      await fetch(
        \`https://www.orulo.com.br/api/v2/buildings?\${params.toString()}\`,
        {
          headers:
            oruloHeaders
        }
      );


    let buildingsData = {};


    try {

      buildingsData =
        await buildingsResponse.json();

    } catch {

      buildingsData = {};

    }


    if (
      !buildingsResponse.ok
    ) {

      return res.status(502).json({
        ok: false,

        error:
          "Falha ao consultar catálogo Órulo",

        page:
          requestedPage,

        status:
          buildingsResponse.status
      });

    }


    const buildings =
      Array.isArray(
        buildingsData.buildings
      )
        ? buildingsData.buildings
        : [];


    const informedTotalPages =
      Number(
        buildingsData.total_pages ??
        buildingsData.meta?.total_pages ??
        buildingsData.pagination?.total_pages ??
        buildingsData.pagination?.pages ??
        0
      ) || 0;


    const totalPagesDetected =
      informedTotalPages > 0
        ? informedTotalPages
        : null;


    console.log(
      "ORULO_SYNC_BATCH_RECEIVED",
      {
        page:
          requestedPage,

        received:
          buildings.length,

        resultsPerPage:
          RESULTS_PER_PAGE,

        totalPagesDetected
      }
    );


    if (
      !buildings.length
    ) {

      return res.status(200).json({
        ok: true,

        done: true,

        message:
          "Nenhum empreendimento nesta página. Carga encerrada.",

        page:
          requestedPage,

        buildings_received:
          0,

        total_pages_detected:
          totalPagesDetected,

        source:
          "novos",

        synced_at:
          new Date().toISOString()
      });

    }


    // =========================================================
    // 3. DETALHES + FOTOS + TIPOLOGIAS + NORMALIZAÇÃO
    // =========================================================

    const rows = [];


    let residentialBuildings =
      0;

    let buildingDetailsLoaded =
      0;

    let buildingDetailsFailed =
      0;

    let galleriesLoaded =
      0;


    for (
      const buildingSummary
      of buildings
    ) {

      try {

        // =====================================================
        // 3.1 FILTRO RESIDENCIAL
        // =====================================================

        const summaryFinality =
          String(
            buildingSummary.finality ||
            ""
          )
            .trim()
            .toLowerCase();


        if (
          summaryFinality !==
          "residencial"
        ) {

          continue;

        }


        residentialBuildings++;


        // =====================================================
        // 3.2 DETALHE COMPLETO DO EMPREENDIMENTO
        // =====================================================

        let building =
          buildingSummary;


        try {

          const detailResponse =
            await fetch(
              \`https://www.orulo.com.br/api/v2/buildings/\${buildingSummary.id}\`,
              {
                headers:
                  oruloHeaders
              }
            );


          if (
            detailResponse.ok
          ) {

            const detailData =
              await detailResponse.json();


            const detailedBuilding =
              detailData?.building &&
              typeof detailData.building ===
                "object"

                ? detailData.building

                : detailData;


            if (
              detailedBuilding &&
              typeof detailedBuilding ===
                "object"
            ) {

              building = {
                ...buildingSummary,
                ...detailedBuilding
              };


              buildingDetailsLoaded++;

            }

          } else {

            buildingDetailsFailed++;


            console.warn(
              "ORULO_BUILDING_DETAIL_HTTP_ERROR",
              buildingSummary.id,
              detailResponse.status
            );

          }

        } catch (
          detailError
        ) {

          buildingDetailsFailed++;


          console.warn(
            "ORULO_BUILDING_DETAIL_ERROR",
            buildingSummary.id,
            detailError
          );

        }


        const finality =
          String(
            building.finality ||
            buildingSummary.finality ||
            ""
          )
            .trim()
            .toLowerCase();


        if (
          finality !==
          "residencial"
        ) {

          continue;

        }


        // =====================================================
        // 3.3 GALERIA DE FOTOS
        // =====================================================

        let galleryImages = [];


        try {

          const imagesParams =
            new URLSearchParams();


          imagesParams.append(
            "dimensions[]",
            "1024x1024"
          );


          const imagesResponse =
            await fetch(
              \`https://www.orulo.com.br/api/v2/buildings/\${buildingSummary.id}/images?\${imagesParams.toString()}\`,
              {
                headers:
                  oruloHeaders
              }
            );


          if (
            imagesResponse.ok
          ) {

            const imagesData =
              await imagesResponse.json();


            const oruloImages =
              Array.isArray(
                imagesData.images
              )
                ? imagesData.images
                : [];


            galleryImages =
              oruloImages

                .map(
                  (image) =>
                    image?.["1024x1024"] ||
                    image?.["2280x1800"] ||
                    image?.["520x280"] ||
                    image?.["200x140"] ||
                    image?.url ||
                    null
                )

                .filter(Boolean)

                .filter(
                  (
                    url,
                    index,
                    array
                  ) =>
                    array.indexOf(url) ===
                    index
                )

                .slice(
                  0,
                  8
                );


            if (
              galleryImages.length
            ) {

              galleriesLoaded++;

            }

          } else {

            console.warn(
              "ORULO_IMAGES_HTTP_ERROR",
              buildingSummary.id,
              imagesResponse.status
            );

          }

        } catch (
          imageError
        ) {

          console.warn(
            "ORULO_IMAGES_ERROR",
            buildingSummary.id,
            imageError
          );

        }


        // =====================================================
        // 3.4 TIPOLOGIAS
        // =====================================================

        const typologiesResponse =
          await fetch(
            \`https://www.orulo.com.br/api/v2/buildings/\${buildingSummary.id}/typologies\`,
            {
              headers:
                oruloHeaders
            }
          );


        if (
          !typologiesResponse.ok
        ) {

          console.warn(
            "ORULO_TYPOLOGIES_HTTP_ERROR",
            buildingSummary.id,
            typologiesResponse.status
          );


          continue;

        }


        const typologiesData =
          await typologiesResponse.json();


        const typologies =
          Array.isArray(
            typologiesData.typologies
          )
            ? typologiesData.typologies
            : [];


        // =====================================================
        // 3.5 CARACTERÍSTICAS DO EMPREENDIMENTO
        // =====================================================

        const buildingFeatures =
          Array.isArray(
            building.building_features
          )
            ? building.building_features

            : Array.isArray(
                building.features
              )
              ? building.features
              : [];


        const unitFeatures =
          Array.isArray(
            building.unit_features
          )
            ? building.unit_features
            : [];


        // =====================================================
        // 3.6 NORMALIZA CADA TIPOLOGIA
        // =====================================================

        for (
          const typology
          of typologies
        ) {

          const stock =
            typology.stock !== undefined &&
            typology.stock !== null
              ? Number(
                  typology.stock
                )
              : null;


          // Não cadastramos produto sem estoque.
          if (
            stock !== null &&
            stock <= 0
          ) {

            continue;

          }


          const externalId =
            \`orulo:\${buildingSummary.id}:\${typology.id}\`;


          const price =
            typology.discount_price ??
            typology.original_price ??
            building.min_price ??
            buildingSummary.min_price ??
            null;


          // ===================================================
          // CAPA
          // ===================================================

          const imageUrl =
            galleryImages[0] ||

            building.default_image?.["1024x1024"] ||

            building.default_image?.["520x280"] ||

            building.default_image?.["2280x1800"] ||

            building.default_image?.["200x140"] ||

            buildingSummary.default_image?.["1024x1024"] ||

            buildingSummary.default_image?.["520x280"] ||

            buildingSummary.default_image?.["2280x1800"] ||

            buildingSummary.default_image?.["200x140"] ||

            null;


          // ===================================================
          // TÍTULO
          // ===================================================

          const titleParts = [

            building.name ||
              buildingSummary.name,


            typology.private_area
              ? \`\${typology.private_area} m²\`
              : null,


            typology.bedrooms !== undefined
              ? \`\${typology.bedrooms} dorm\`
              : null

          ].filter(Boolean);


          // ===================================================
          // FEATURES DA UNIDADE ASSOCIADAS À TIPOLOGIA
          // ===================================================

          const typologyUnitFeatures =
            unitFeatures.filter(
              (feature) => {

                const associatedTypologies =
                  feature?.associations?.typologies;


                if (
                  !Array.isArray(
                    associatedTypologies
                  ) ||
                  !associatedTypologies.length
                ) {

                  return true;

                }


                return associatedTypologies

                  .map(String)

                  .includes(
                    String(
                      typology.id
                    )
                  );

              }
            );


          // ===================================================
          // SALVA PROPERTY
          // ===================================================

          rows.push({

            external_id:
              externalId,


            source:
              "novos",


            title:
              titleParts.join(" | "),


            development_name:
              building.name ||
              buildingSummary.name ||
              null,


            neighborhood:
              building.address?.area ||
              buildingSummary.address?.area ||
              null,


            city:
              building.address?.city ||
              buildingSummary.address?.city ||
              "São Paulo",


            state:
              building.address?.state ||
              buildingSummary.address?.state ||
              "SP",


            price:
              price !== null
                ? Number(price)
                : null,


            bedrooms:
              typology.bedrooms !== undefined
                ? Number(
                    typology.bedrooms
                  )
                : null,


            bathrooms:
              typology.bathrooms !== undefined
                ? Number(
                    typology.bathrooms
                  )
                : null,


            parking_spaces:
              typology.parking !== undefined
                ? Number(
                    typology.parking
                  )
                : null,


            area:
              typology.private_area !== undefined
                ? Number(
                    typology.private_area
                  )
                : null,


            image_url:
              imageUrl,


            property_url:
              building.orulo_url ||
              building.sharing_url ||
              building.webpage ||
              buildingSummary.orulo_url ||
              null,


            active:
              true,


            // =================================================
            // RAW DATA COMPLETO
            // =================================================

            raw_data: {

              source:
                "orulo",


              building_id:
                String(
                  buildingSummary.id
                ),


              typology_id:
                String(
                  typology.id
                ),


              // ===============================================
              // GALERIA
              // ===============================================

              images:
                galleryImages,


              // ===============================================
              // TIPOLOGIA / UNIDADE
              // ===============================================

              typology: {

                id:
                  typology.id ??
                  null,


                type:
                  typology.type ??
                  null,


                private_area:
                  typology.private_area ??
                  null,


                bedrooms:
                  typology.bedrooms ??
                  null,


                bathrooms:
                  typology.bathrooms ??
                  null,


                suites:
                  typology.suites ??
                  null,


                parking:
                  typology.parking ??
                  null,


                stock,


                original_price:
                  typology.original_price ??
                  null,


                discount_price:
                  typology.discount_price ??
                  null,


                reference:
                  typology.reference ??
                  null,


                floor_reference:
                  typology.floor_reference ??
                  null,


                section_reference:
                  typology.section_reference ??
                  null,


                features:
                  typologyUnitFeatures,


                updated_at:
                  typology.updated_at ??
                  null
              },


              // ===============================================
              // EMPREENDIMENTO / FICHA TÉCNICA
              // ===============================================

              building: {

                id:
                  building.id ??
                  buildingSummary.id ??
                  null,


                name:
                  building.name ??
                  buildingSummary.name ??
                  null,


                finality:
                  building.finality ??
                  buildingSummary.finality ??
                  null,


                status:
                  building.status ??
                  null,


                stage:
                  building.stage ??
                  null,


                type:
                  building.type ??
                  null,


                // ---------------------------------------------
                // INCORPORADORA
                // ---------------------------------------------

                developer:
                  building.developer?.name ??
                  building.publisher?.name ??
                  null,


                developer_data:
                  building.developer ??
                  null,


                publisher:
                  building.publisher?.name ??
                  null,


                // ---------------------------------------------
                // DESCRIÇÃO
                // ---------------------------------------------

                description:
                  building.description ??
                  null,


                // ---------------------------------------------
                // DATAS
                // opening_date = entrega
                // ---------------------------------------------

                opening_date:
                  building.opening_date ??
                  null,


                launch_date:
                  building.launch_date ??
                  null,


                // ---------------------------------------------
                // FICHA TÉCNICA
                // ---------------------------------------------

                total_units:
                  building.total_units ??
                  null,


                number_of_towers:
                  building.number_of_towers ??
                  null,


                number_of_floors:
                  building.number_of_floors ??
                  null,


                apts_per_floor:
                  building.apts_per_floor ??
                  null,


                total_area:
                  building.total_area ??
                  null,


                floor_area:
                  building.floor_area ??
                  null,


                min_price:
                  building.min_price ??
                  null,


                stock:
                  building.stock ??
                  null,


                // ---------------------------------------------
                // ENDEREÇO
                // ---------------------------------------------

                address:
                  building.address ??
                  buildingSummary.address ??
                  null,


                // ---------------------------------------------
                // FOTOS
                // ---------------------------------------------

                images:
                  galleryImages,


                // ---------------------------------------------
                // CARACTERÍSTICAS CONDOMINIAIS
                // ---------------------------------------------

                building_features:
                  buildingFeatures,


                // Compatibilidade com versão anterior
                features:
                  buildingFeatures,


                // ---------------------------------------------
                // CARACTERÍSTICAS DAS UNIDADES
                // ---------------------------------------------

                unit_features:
                  unitFeatures,


                // ---------------------------------------------
                // MÍDIA / LINKS
                // ---------------------------------------------

                webpage:
                  building.webpage ??
                  null,


                sharing_url:
                  building.sharing_url ??
                  null,


                orulo_url:
                  building.orulo_url ??
                  buildingSummary.orulo_url ??
                  null,


                virtual_tour:
                  building.virtual_tour ??
                  null,


                videos:
                  building.videos ??
                  [],


                // Se o detalhe já retornar plantas,
                // preservamos os metadados aqui.
                floor_plans:
                  building.floor_plans ??
                  [],


                // Arquivos que eventualmente vierem no detalhe.
                files:
                  building.files ??
                  [],


                // ---------------------------------------------
                // COMERCIAL
                // ---------------------------------------------

                payment_conditions:
                  building.payment_conditions ??
                  [],


                opportunity:
                  building.opportunity ??
                  null,


                last_updated_pricetable_at:
                  building.last_updated_pricetable_at ??
                  null,


                // ---------------------------------------------
                // CONTROLE
                // ---------------------------------------------

                updated_at:
                  building.updated_at ??
                  null

              }

            },


            updated_at:
              new Date().toISOString()

          });

        }

      } catch (
        error
      ) {

        console.error(
          "ORULO_BUILDING_PROCESS_ERROR",
          buildingSummary.id,
          error
        );

      }

    }


    // =========================================================
    // 4. VALIDAÇÃO
    // =========================================================

    if (
      !rows.length
    ) {

      const done =
        totalPagesDetected !== null
          ? requestedPage >=
            totalPagesDetected
          : buildings.length <
            RESULTS_PER_PAGE;


      const nextPage =
        done
          ? null
          : requestedPage + 1;


      return res.status(200).json({

        ok:
          true,


        message:
          "Lote processado sem tipologias residenciais válidas. Continue para a próxima página.",


        page:
          requestedPage,


        results_per_page:
          RESULTS_PER_PAGE,


        buildings_received:
          buildings.length,


        total_pages_detected:
          totalPagesDetected,


        residential_buildings:
          residentialBuildings,


        building_details_loaded:
          buildingDetailsLoaded,


        building_details_failed:
          buildingDetailsFailed,


        galleries_loaded:
          galleriesLoaded,


        properties_processed:
          0,


        properties_saved:
          0,


        done,


        next_page:
          nextPage,


        next_url:
          nextPage

            ? \`https://\${req.headers.host}/api/orulo-sync?page=\${nextPage}\`

            : null,


        source:
          "novos",


        synced_at:
          new Date().toISOString()

      });

    }


    // =========================================================
    // 5. CARGA INCREMENTAL SEGURA
    // =========================================================
    //
    // NÃO fazemos:
    //
    // PATCH source=novos active=false
    //
    // durante a carga em lotes.
    //
    // Se fizéssemos isso em cada página,
    // os registros salvos na página anterior seriam desativados.
    //
    // O upsert:
    //
    // - cria imóveis novos
    // - atualiza existentes
    // - mantém lotes anteriores ativos
    //
    // As remoções posteriores continuam sendo tratadas
    // pelo webhook da Órulo.
    //
    // =========================================================


    // =========================================================
    // 6. UPSERT NO SUPABASE
    // =========================================================

    const supabaseResponse =
      await fetch(

        \`\${SUPABASE_URL}/rest/v1/properties?on_conflict=external_id\`,

        {

          method:
            "POST",


          headers: {

            apikey:
              supabaseSecretKey,


            Authorization:
              \`Bearer \${supabaseSecretKey}\`,


            "Content-Type":
              "application/json",


            Prefer:
              "resolution=merge-duplicates,return=representation"

          },


          body:
            JSON.stringify(
              rows
            )

        }

      );


    const supabaseText =
      await supabaseResponse.text();


    if (
      !supabaseResponse.ok
    ) {

      console.error(
        "SUPABASE_SYNC_ERROR",
        supabaseResponse.status,
        supabaseText
      );


      return res.status(502).json({

        ok:
          false,


        error:
          "Falha ao gravar catálogo no Supabase",


        status:
          supabaseResponse.status,


        details:
          supabaseText

      });

    }


    let savedRows = [];


    try {

      savedRows =
        JSON.parse(
          supabaseText
        );

    } catch {

      savedRows = [];

    }


    // =========================================================
    // 7. RESULTADO
    // =========================================================

    const done =
      totalPagesDetected !== null

        ? requestedPage >=
          totalPagesDetected

        : buildings.length <
          RESULTS_PER_PAGE;


    const nextPage =
      done
        ? null
        : requestedPage + 1;


    return res.status(200).json({

      ok:
        true,


      message:
        "Catálogo Órulo enriquecido e sincronizado com o Supabase",


      page:
        requestedPage,


      results_per_page:
        RESULTS_PER_PAGE,


      buildings_received:
        buildings.length,


      total_pages_detected:
        totalPagesDetected,


      residential_buildings:
        residentialBuildings,


      building_details_loaded:
        buildingDetailsLoaded,


      building_details_failed:
        buildingDetailsFailed,


      galleries_loaded:
        galleriesLoaded,


      properties_processed:
        rows.length,


      properties_saved:
        Array.isArray(
          savedRows
        )
          ? savedRows.length
          : rows.length,


      done,


      next_page:
        nextPage,


      next_url:
        nextPage

          ? \`https://\${req.headers.host}/api/orulo-sync?page=\${nextPage}\`

          : null,


      source:
        "novos",


      synced_at:
        new Date().toISOString()

    });


  } catch (
    error
  ) {

    console.error(
      "ORULO_SYNC_FATAL",
      error
    );


    return res.status(500).json({

      ok:
        false,


      error:
        "Erro interno durante sincronização Órulo"

    });

  }

}
