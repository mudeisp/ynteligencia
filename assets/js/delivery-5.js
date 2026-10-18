
;
// SOURCE: assets/js/state/app-state.js
// Extracted unchanged from outputs/index-home-agent-fix-test.html; original initial state/identity sequence.
// Classic script: intentional shared global scope; see docs/global-compatibility.md.

// Original main L4860
const CSV_FILE="Remax.teste.2.csv";

// Original main L4862
const USE_CSV_INVENTORY=false;

// Original main L4863
const SUPABASE_PROPERTIES_URL =
  "https://wzaegidwtdjuhqchpdpd.supabase.co/rest/v1/properties?source=eq.novos&active=eq.true&select=*";

// Original main L4865
let properties=[];

// Original main L4866
let sourceMode="todos";

// Original main L4873
let inventoryReady=false;

// Original main L4874
let inventoryLoading=true;

// Original main L4875
let inventoryLoadError=false;

// Original main L4877
const CATALOG_PAGE_SIZE=30;

// Original main L4878
let usedPropertiesCache=[];

// Original main L4879
let usedInventoryLoaded=!USE_CSV_INVENTORY;

// Original main L4880
let usedInventoryLoading=false;

// Original main L4881
let newPropertiesCache=[];

// Original main L4882
let newCatalogOffset=0;

// Original main L4883
let newCatalogHasMore=true;

// Original main L4884
let newCatalogLoading=false;

// Original main L4885
let newCatalogTotal=0;

// Original main L4886
let newCatalogRequestId=0;

// Original main L4894
const initialLocationParams=
  new URLSearchParams(window.location.search);

// Original main L4897
let activeCity=
  cleanAdParam(
    initialLocationParams.get("cidade") ||
    initialLocationParams.get("city") ||
    "São Paulo"
  ) || "São Paulo";

// Original main L4904
let activeState=
  String(
    initialLocationParams.get("estado") ||
    initialLocationParams.get("state") ||
    "SP"
  )
  .trim()
  .toUpperCase() || "SP";

// Original main L4917
const paidSearch=PaidClickExperience.readSearchParams(window.location.search);

// Original main L4918
const adIntent={
  neighborhood:paidSearch.neighborhood,
  region:paidSearch.region,
  bedrooms:paidSearch.bedrooms,
  minPrice:paidSearch.minPrice,
  maxPrice:paidSearch.maxPrice,
  type:paidSearch.type,
  search:paidSearch.search,
  development:paidSearch.development,
  active:paidSearch.directToResults
};

// Original main L4973
let profile={
  purpose:"",
  region:"",
  budget:0,
  budgetMin:0,
  budgetMax:0,
  budgetLabel:"",
  bedrooms:null,
  feature:[],
  timing:"",
  types:[]
};

// Original main L4986
let step=0;

// Original main L4988
const $=id=>document.getElementById(id);

// Original main L4990
const steps=[
  ...document.querySelectorAll(".step")
];

// Original main L5012
const SUPABASE_URL =
  "https://wzaegidwtdjuhqchpdpd.supabase.co";

// Original main L5015
const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_YmN9DjeDgog_mlVw9EsDUQ_Z-4MJKsp";

// Original main L5026
const currentMatchById=new Map();

// Original main L5256
const YNTELIGENCIA_VISITOR_ID =
  getYnteligenciaVisitorId();

// Original main L5273
const YNT_SESSION_TIMEOUT_MS =
  30 * 60 * 1000;

// Original main L5445
const YNTELIGENCIA_SESSION =
  resolveYnteligenciaSession();

// Original main L5448
const YNTELIGENCIA_SESSION_ID =
  YNTELIGENCIA_SESSION.id;

// Original main L5514
let YNT_ACTIVE_PROPERTY_JOURNEY = null;

// Original main L5602
const YNTELIGENCIA_ATTRIBUTION =
  captureYnteligenciaAttribution();

// Original main L5975
const YNTELIGENCIA_TOUCHES =
  resolveYnteligenciaTouches();

// Original main L6344
let yntAgentHandoffPending=false;

// Original main L6345
let yntAgentHandoffLastAttempt=null;
