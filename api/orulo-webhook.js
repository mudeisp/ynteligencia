// =========================================================
// BUSCA GALERIA
// =========================================================

async function getBuildingImages(
  buildingId,
  headers
) {
  try {
    const params =
      new URLSearchParams();

    params.append(
      "dimensions[]",
      "1024x1024"
    );

    const response = await fetch(
      `https://www.orulo.com.br/api/v2/buildings/${encodeURIComponent(
        String(buildingId)
      )}/images?${params.toString()}`,
      {
        headers
      }
    );

    if (!response.ok) {
      console.warn(
        "ORULO_WEBHOOK_IMAGES_HTTP_ERROR",
        buildingId,
        response.status
      );

      return [];
    }

    const data =
      await response.json();

    const images =
      Array.isArray(data.images)
        ? data.images
        : [];

    return images
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
        (url, index, array) =>
          array.indexOf(url) === index
      );

  } catch (error) {
    console.warn(
      "ORULO_WEBHOOK_IMAGES_ERROR",
      buildingId,
      error
    );

    return [];
  }
}
