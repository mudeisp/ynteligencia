/*
  Materializa latitude/longitude para a busca geográfica futura.

  Não geocodifica, não estima e não altera o endereço bruto.
  Um par inválido vira null/null para o upsert completo não
  conservar um ponto que a fonte atual não sustenta.
*/

(function inventoryCoordinatesModule(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  if (typeof root !== "undefined") {
    root.InventoryCoordinates = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function inventoryCoordinatesFactory() {
  function finiteCoordinate(value) {
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null;
    }

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return null;
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
  }

  function normalizeCoordinates(latitude, longitude) {
    const lat = finiteCoordinate(latitude);
    const lng = finiteCoordinate(longitude);
    const valid = lat !== null &&
      lng !== null &&
      lat !== 0 &&
      lng !== 0 &&
      lat >= -90 &&
      lat <= 90 &&
      lng >= -180 &&
      lng <= 180;

    if (!valid) {
      return {
        latitude: null,
        longitude: null
      };
    }

    return {
      latitude: lat,
      longitude: lng
    };
  }

  function coordinateFieldsPresent(address) {
    if (!address || typeof address !== "object") return false;
    return (address.latitude !== undefined && address.latitude !== null) ||
      (address.longitude !== undefined && address.longitude !== null);
  }

  function coordinatesFromOruloBuilding(building, fallbackBuilding) {
    const primary = building && building.address;
    const fallback = fallbackBuilding && fallbackBuilding.address;
    const address = coordinateFieldsPresent(primary)
      ? primary
      : coordinateFieldsPresent(fallback)
        ? fallback
        : null;

    if (!address) {
      return {
        latitude: null,
        longitude: null
      };
    }

    return normalizeCoordinates(address.latitude, address.longitude);
  }

  function coordinatesFromNonstopProperty(property) {
    const coordinates = property &&
      property.address &&
      property.address.geo &&
      property.address.geo.coordinates;

    if (!Array.isArray(coordinates) || coordinates.length < 2) {
      return {
        latitude: null,
        longitude: null
      };
    }

    return normalizeCoordinates(coordinates[1], coordinates[0]);
  }

  function deactivationPatch(now = new Date()) {
    const date = now instanceof Date ? now : new Date(now);
    return {
      active: false,
      updated_at: date.toISOString()
    };
  }

  return {
    normalizeCoordinates,
    coordinatesFromOruloBuilding,
    coordinatesFromNonstopProperty,
    deactivationPatch
  };
});
