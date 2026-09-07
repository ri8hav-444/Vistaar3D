import React, { useState, useEffect, useRef, useMemo, useCallback, forwardRef, useImperativeHandle } from "react";
import * as THREE from "three";
import {
  LayoutDashboard, Files, Map as MapIcon, Box as BoxIcon, Database, Cpu,
  ClipboardList, ChevronRight, Building2, MapPin, CheckCircle2, Circle,
  Loader2, Camera, Radar, Layers, FileText, Satellite, Mountain,
  RotateCcw, Info, ArrowRight, Compass, ZoomIn, ZoomOut, ArrowLeft, Maximize2, Minimize2
} from "lucide-react";

/* ============================================================
   VISTAAR3D — 3D ULPIN Generation & Vertical Property Mapping
   Team TwinSpark

   Core flow: 2D Map -> select an AREA -> Generate 3D Area
   -> complete area with multiple buildings -> click a building
   (camera focuses on it) -> click a floor -> floor details
   -> Generate 3D ULPIN.
   ============================================================ */

/* ---------------------------- DATA SOURCES / PIPELINE ---------------------------- */

const DATA_SOURCES = [
  { id: "drone", name: "Drone Imagery", icon: Camera, blurb: "Orthophoto capture of the area and rooftop footprints.", file: "sasnagar_sec82_ortho.tif", size: "184 MB" },
  { id: "lidar", name: "LiDAR / Point Cloud", icon: Radar, blurb: "Dense point cloud used for building heights and floor extraction.", file: "areablock_pointcloud.las", size: "612 MB" },
  { id: "gis", name: "GIS Parcel Layers", icon: Layers, blurb: "Cadastral parcel boundaries and existing 2D ULPIN records.", file: "punjab_cadastre_sec82.geojson", size: "3.1 MB" },
  { id: "plans", name: "Building Floor Plans", icon: FileText, blurb: "Architectural floor plans used to delineate vertical units.", file: "area_floor_plans.dwg", size: "9.4 MB" },
  { id: "gnss", name: "GNSS / CORS", icon: Satellite, blurb: "Survey-grade correction data for absolute georeferencing.", file: "cors_mohali_20260812.rnx", size: "22 MB" },
  { id: "dem", name: "DEM / DSM", icon: Mountain, blurb: "Terrain and surface elevation models for vertical datum alignment.", file: "dem_dsm_sec82_1m.tif", size: "76 MB" },
];

const PROCESSING_STEPS = [
  { id: "load", label: "Area & Parcel Data Loaded", detail: "2D area boundary, individual parcels and existing ULPIN records read from GIS layers." },
  { id: "extract", label: "Building Extraction", detail: "Every building footprint and height in the area isolated from LiDAR + drone imagery." },
  { id: "segment", label: "Floor Segmentation", detail: "Each building's point cloud sliced into individual floor levels using height clustering." },
  { id: "delineate", label: "Vertical Parcel Delineation", detail: "Floors divided into vertical property units from floor plans, where available." },
  { id: "validate", label: "Topology Validation", detail: "Checking that floor and unit geometries are closed, non-overlapping and stacked consistently across all buildings." },
  { id: "ready", label: "3D Area Model Ready", detail: "Complete multi-building 3D area generated and ready for building/floor inspection." },
];

/* ---------------------------- FLOOR-STACKING HELPER ---------------------------- */

function stackFloors(buildingCode, specs) {
  let cum = 0;
  return specs.map((f, i) => {
    const floorCode = `F${String(i).padStart(2, "0")}`;
    const elevationLabel = cum === 0 ? "0.0 m" : `+${cum.toFixed(1)} m`;
    const sceneHeight = +(f.heightM / 3.3).toFixed(2);
    const out = {
      id: `${buildingCode}-${floorCode}`,
      code: floorCode,
      order: i,
      belowGrade: false,
      name: f.name,
      usage: f.usage,
      propertyType: f.propertyType,
      areaSqm: f.areaSqm,
      elevationLabel,
      heightM: f.heightM,
      sceneHeight,
      footprintScale: f.footprintScale || 1,
      colorHex: f.colorHex,
      mappingStatus: f.mappingStatus || "Mapped",
      units: f.units || null,
    };
    cum += f.heightM;
    return out;
  });
}

function sumHeights(floors) {
  return +floors.reduce((s, f) => s + f.heightM, 0).toFixed(1);
}

/* ---------------------------- BUILDINGS: AREA 1 (Sector 82, Mohali) ---------------------------- */

// BLD-01 — hero building for Area 1: full unit-level detail, ULPIN-capable.
const BLD_01 = {
  id: "BLD-01", code: "BLD01", type: "Mixed-Use (G+3)",
  footprintSqm: 112, heightM: 16.4,
  floors: [
    {
      id: "BLD01-F00", code: "F00", order: 0, belowGrade: true,
      name: "Basement", usage: "Parking & Utility", propertyType: "Utility",
      areaSqm: 92, elevationLabel: "-2.8 m", heightM: 2.8, sceneHeight: 0.85, footprintScale: 1,
      colorHex: 0x8a9088, mappingStatus: "Mapped",
      units: [{ id: "UT-B01", code: "U001", label: "Parking / Utility Bay", areaSqm: 92, type: "Utility" }],
    },
    {
      id: "BLD01-F01", code: "F01", order: 1, belowGrade: false,
      name: "Ground Floor", usage: "Commercial · Retail", propertyType: "Commercial",
      areaSqm: 105, elevationLabel: "0.0 m", heightM: 3.6, sceneHeight: 1.05, footprintScale: 1,
      colorHex: 0xb5842e, mappingStatus: "Mapped",
      units: [
        { id: "UT-101", code: "U101", label: "Shop 101", areaSqm: 54, type: "Commercial" },
        { id: "UT-102", code: "U102", label: "Shop 102", areaSqm: 51, type: "Commercial" },
      ],
    },
    {
      id: "BLD01-F02", code: "F02", order: 2, belowGrade: false,
      name: "1st Floor", usage: "Residential", propertyType: "Residential",
      areaSqm: 98, elevationLabel: "+3.6 m", heightM: 3.2, sceneHeight: 0.95, footprintScale: 1,
      colorHex: 0x1f6e5c, mappingStatus: "Mapped",
      units: [
        { id: "UT-201", code: "U201", label: "Unit 201", areaSqm: 50, type: "Residential" },
        { id: "UT-202", code: "U202", label: "Unit 202", areaSqm: 48, type: "Residential" },
      ],
    },
    {
      id: "BLD01-F03", code: "F03", order: 3, belowGrade: false,
      name: "2nd Floor", usage: "Residential", propertyType: "Residential",
      areaSqm: 98, elevationLabel: "+6.8 m", heightM: 3.2, sceneHeight: 0.95, footprintScale: 1,
      colorHex: 0x1f6e5c, mappingStatus: "Mapped",
      units: [
        { id: "UT-301", code: "U301", label: "Unit 301", areaSqm: 50, type: "Residential" },
        { id: "UT-302", code: "U302", label: "Unit 302", areaSqm: 48, type: "Residential" },
      ],
    },
    {
      id: "BLD01-F04", code: "F04", order: 4, belowGrade: false,
      name: "3rd Floor", usage: "Residential", propertyType: "Residential",
      areaSqm: 96, elevationLabel: "+10.0 m", heightM: 3.2, sceneHeight: 0.95, footprintScale: 1,
      colorHex: 0x1f6e5c, mappingStatus: "Mapped",
      units: [{ id: "UT-401", code: "U401", label: "Unit 401 (Full Floor)", areaSqm: 96, type: "Residential" }],
    },
    {
      id: "BLD01-F05", code: "F05", order: 5, belowGrade: false,
      name: "Terrace", usage: "Open Terrace & Utility", propertyType: "Utility",
      areaSqm: 88, elevationLabel: "+13.2 m", heightM: 1.2, sceneHeight: 0.35, footprintScale: 0.92,
      colorHex: 0xc7ccc2, mappingStatus: "Partially Mapped",
      units: [{ id: "UT-501", code: "U501", label: "Terrace / Water Tank Area", areaSqm: 88, type: "Utility" }],
    },
  ],
};

const BLD_02 = (() => {
  const floors = stackFloors("BLD02", [
    { name: "Ground Floor", usage: "Residential", propertyType: "Residential", areaSqm: 70, heightM: 3.0, colorHex: 0x2b7a68,
      units: [{ id: "BLD02-U001", code: "U001", label: "Ground Unit", areaSqm: 70, type: "Residential" }] },
    { name: "1st Floor", usage: "Residential", propertyType: "Residential", areaSqm: 68, heightM: 3.0, colorHex: 0x2b7a68,
      units: [
        { id: "BLD02-U101", code: "U101", label: "Unit 101", areaSqm: 34, type: "Residential" },
        { id: "BLD02-U102", code: "U102", label: "Unit 102", areaSqm: 34, type: "Residential" },
      ] },
    { name: "2nd Floor", usage: "Residential", propertyType: "Residential", areaSqm: 68, heightM: 3.0, colorHex: 0x2b7a68,
      units: [
        { id: "BLD02-U201", code: "U201", label: "Unit 201", areaSqm: 34, type: "Residential" },
        { id: "BLD02-U202", code: "U202", label: "Unit 202", areaSqm: 34, type: "Residential" },
      ] },
    { name: "3rd Floor", usage: "Residential", propertyType: "Residential", areaSqm: 64, heightM: 3.0, colorHex: 0x2b7a68, footprintScale: 0.94,
      units: [{ id: "BLD02-U301", code: "U301", label: "Unit 301 (Full Floor)", areaSqm: 64, type: "Residential" }] },
  ]);
  return { id: "BLD-02", code: "BLD02", type: "Residential (G+3)", footprintSqm: 70, heightM: sumHeights(floors), floors };
})();

const BLD_03 = (() => {
  const floors = stackFloors("BLD03", [
    { name: "Ground Floor", usage: "Residential", propertyType: "Residential", areaSqm: 52, heightM: 3.0, colorHex: 0x235f4f,
      units: [{ id: "BLD03-U001", code: "U001", label: "Ground Unit", areaSqm: 52, type: "Residential" }] },
    { name: "1st Floor", usage: "Residential", propertyType: "Residential", areaSqm: 50, heightM: 3.0, colorHex: 0x235f4f,
      units: [
        { id: "BLD03-U101", code: "U101", label: "Unit 101", areaSqm: 25, type: "Residential" },
        { id: "BLD03-U102", code: "U102", label: "Unit 102", areaSqm: 25, type: "Residential" },
      ] },
    { name: "2nd Floor", usage: "Residential", propertyType: "Residential", areaSqm: 48, heightM: 3.0, colorHex: 0x235f4f, footprintScale: 0.92,
      units: [{ id: "BLD03-U201", code: "U201", label: "Unit 201 (Full Floor)", areaSqm: 48, type: "Residential" }] },
  ]);
  return { id: "BLD-03", code: "BLD03", type: "Residential (G+2)", footprintSqm: 52, heightM: sumHeights(floors), floors };
})();

const BLD_04 = (() => {
  const floors = stackFloors("BLD04", [
    { name: "Ground Floor", usage: "Commercial · Retail", propertyType: "Commercial", areaSqm: 46, heightM: 3.4, colorHex: 0xa8752a,
      units: [{ id: "BLD04-U001", code: "U001", label: "Shop 001", areaSqm: 46, type: "Commercial" }] },
    { name: "1st Floor", usage: "Residential", propertyType: "Residential", areaSqm: 44, heightM: 3.0, colorHex: 0x2b7a68,
      units: [{ id: "BLD04-U101", code: "U101", label: "Unit 101", areaSqm: 44, type: "Residential" }] },
  ]);
  return { id: "BLD-04", code: "BLD04", type: "Mixed-Use (G+1)", footprintSqm: 46, heightM: sumHeights(floors), floors };
})();

/* ---------------------------- BUILDINGS: AREA 2 (Model Town, Karnal) ---------------------------- */

const BLD_05 = {
  id: "BLD-05", code: "BLD05", type: "Residential (G+3)",
  footprintSqm: 80, heightM: 12.6,
  floors: [
    {
      id: "BLD05-F00", code: "F00", order: 0, belowGrade: false,
      name: "Ground Floor", usage: "Residential", propertyType: "Residential",
      areaSqm: 80, elevationLabel: "0.0 m", heightM: 3.2, sceneHeight: 0.97, footprintScale: 1,
      colorHex: 0x2f6b52, mappingStatus: "Mapped",
      units: [{ id: "UT-G01", code: "U001", label: "Ground Unit", areaSqm: 80, type: "Residential" }],
    },
    {
      id: "BLD05-F01", code: "F01", order: 1, belowGrade: false,
      name: "1st Floor", usage: "Residential", propertyType: "Residential",
      areaSqm: 78, elevationLabel: "+3.2 m", heightM: 3.2, sceneHeight: 0.97, footprintScale: 1,
      colorHex: 0x2f6b52, mappingStatus: "Mapped",
      units: [
        { id: "UT-201B", code: "U201", label: "Unit 201", areaSqm: 40, type: "Residential" },
        { id: "UT-202B", code: "U202", label: "Unit 202", areaSqm: 38, type: "Residential" },
      ],
    },
    {
      id: "BLD05-F02", code: "F02", order: 2, belowGrade: false,
      name: "2nd Floor", usage: "Residential", propertyType: "Residential",
      areaSqm: 78, elevationLabel: "+6.4 m", heightM: 3.2, sceneHeight: 0.97, footprintScale: 1,
      colorHex: 0x2f6b52, mappingStatus: "Mapped",
      units: [
        { id: "UT-301B", code: "U301", label: "Unit 301", areaSqm: 40, type: "Residential" },
        { id: "UT-302B", code: "U302", label: "Unit 302", areaSqm: 38, type: "Residential" },
      ],
    },
    {
      id: "BLD05-F03", code: "F03", order: 3, belowGrade: false,
      name: "3rd Floor", usage: "Residential", propertyType: "Residential",
      areaSqm: 70, elevationLabel: "+9.6 m", heightM: 3.0, sceneHeight: 0.91, footprintScale: 0.9,
      colorHex: 0x2f6b52, mappingStatus: "Mapped",
      units: [{ id: "UT-401B", code: "U401", label: "Unit 401 (Full Floor)", areaSqm: 70, type: "Residential" }],
    },
  ],
};

const BLD_06 = (() => {
  const floors = stackFloors("BLD06", [
    { name: "Ground Floor", usage: "Residential", propertyType: "Residential", areaSqm: 58, heightM: 3.0, colorHex: 0x336f57,
      units: [{ id: "BLD06-U001", code: "U001", label: "Ground Unit", areaSqm: 58, type: "Residential" }] },
    { name: "1st Floor", usage: "Residential", propertyType: "Residential", areaSqm: 56, heightM: 3.0, colorHex: 0x336f57,
      units: [
        { id: "BLD06-U101", code: "U101", label: "Unit 101", areaSqm: 28, type: "Residential" },
        { id: "BLD06-U102", code: "U102", label: "Unit 102", areaSqm: 26, type: "Residential" },
      ] },
    { name: "2nd Floor", usage: "Residential", propertyType: "Residential", areaSqm: 54, heightM: 3.0, colorHex: 0x336f57, footprintScale: 0.93,
      units: [{ id: "BLD06-U201", code: "U201", label: "Unit 201 (Full Floor)", areaSqm: 54, type: "Residential" }] },
  ]);
  return { id: "BLD-06", code: "BLD06", type: "Residential (G+2)", footprintSqm: 58, heightM: sumHeights(floors), floors };
})();

const BLD_07 = (() => {
  const floors = stackFloors("BLD07", [
    { name: "Ground Floor", usage: "Commercial · Retail", propertyType: "Commercial", areaSqm: 40, heightM: 3.2, colorHex: 0x8f6a2a,
      units: [{ id: "BLD07-U001", code: "U001", label: "Shop 001", areaSqm: 40, type: "Commercial" }] },
    { name: "1st Floor", usage: "Residential", propertyType: "Residential", areaSqm: 38, heightM: 3.0, colorHex: 0x336f57,
      units: [{ id: "BLD07-U101", code: "U101", label: "Unit 101", areaSqm: 38, type: "Residential" }] },
  ]);
  return { id: "BLD-07", code: "BLD07", type: "Mixed-Use (G+1)", footprintSqm: 40, heightM: sumHeights(floors), floors };
})();

/* ---------------------------- AREAS ---------------------------- */

const AREAS = [
  {
    id: "AREA-01",
    code: "AREA-01",
    name: "Sector 82 Block",
    district: "SAS Nagar (Mohali)",
    state: "Punjab",
    coordinates: "30.7046° N, 76.7179° E",
    altitudeM: 316,
    map2D: {
      boundary: [[30, 50], [300, 40], [310, 220], [20, 230]],
      roadY: [122, 148],
    },
    scene3D: { boundary: [[-5.3, -4.0], [3.2, -4.3], [3.4, 4.0], [-5.1, 4.2]], roadZ: 0, roadWidth: 1.8 },
    parcels: [
      {
        id: "P-001A", parcelId: "PB/SAS/014/0231", ulpin2D: "PB-MOH-04521",
        areaSqm: 312, landUse: "Mixed Use (Commercial + Residential)",
        position: { x: -3.0, z: -2.3 }, footprintW: 3.1, footprintD: 2.5,
        mapFootprint: [[70, 60], [160, 55], [165, 115], [68, 120]],
        building: BLD_01,
      },
      {
        id: "P-001B", parcelId: "PB/SAS/014/0232", ulpin2D: "PB-MOH-04522",
        areaSqm: 210, landUse: "Residential",
        position: { x: 0.6, z: -2.3 }, footprintW: 2.4, footprintD: 2.0,
        mapFootprint: [[190, 58], [260, 55], [262, 110], [192, 113]],
        building: BLD_02,
      },
      {
        id: "P-001C", parcelId: "PB/SAS/014/0233", ulpin2D: "PB-MOH-04523",
        areaSqm: 165, landUse: "Residential",
        position: { x: -2.0, z: 2.3 }, footprintW: 2.0, footprintD: 1.8,
        mapFootprint: [[60, 155], [130, 150], [135, 205], [58, 210]],
        building: BLD_03,
      },
      {
        id: "P-001D", parcelId: "PB/SAS/014/0234", ulpin2D: "PB-MOH-04524",
        areaSqm: 140, landUse: "Mixed Use (Commercial + Residential)",
        position: { x: 1.6, z: 2.3 }, footprintW: 1.8, footprintD: 1.6,
        mapFootprint: [[200, 150], [260, 148], [262, 195], [198, 198]],
        building: BLD_04,
      },
    ],
    processed: false,
  },
  {
    id: "AREA-02",
    code: "AREA-02",
    name: "Model Town Block",
    district: "Karnal",
    state: "Haryana",
    coordinates: "29.6857° N, 76.9905° E",
    altitudeM: 250,
    map2D: {
      boundary: [[35, 45], [290, 50], [280, 215], [30, 210]],
      roadY: [118, 142],
    },
    scene3D: { boundary: [[-3.8, -3.6], [2.9, -3.8], [3.0, 3.6], [-3.6, 3.8]], roadZ: 0, roadWidth: 1.8 },
    parcels: [
      {
        id: "P-002A", parcelId: "HR/KNL/007/1187", ulpin2D: "HR-KNL-01187",
        areaSqm: 250, landUse: "Residential",
        position: { x: -1.8, z: -2.1 }, footprintW: 2.6, footprintD: 2.2,
        mapFootprint: [[60, 55], [150, 50], [155, 110], [58, 115]],
        building: BLD_05,
      },
      {
        id: "P-002B", parcelId: "HR/KNL/007/1188", ulpin2D: "HR-KNL-01188",
        areaSqm: 190, landUse: "Residential",
        position: { x: 1.2, z: -2.1 }, footprintW: 2.0, footprintD: 1.8,
        mapFootprint: [[190, 52], [250, 55], [248, 108], [188, 112]],
        building: BLD_06,
      },
      {
        id: "P-002C", parcelId: "HR/KNL/007/1189", ulpin2D: "HR-KNL-01189",
        areaSqm: 150, landUse: "Mixed Use (Commercial + Residential)",
        position: { x: 0, z: 2.1 }, footprintW: 1.8, footprintD: 1.6,
        mapFootprint: [[110, 150], [190, 148], [192, 200], [108, 202]],
        building: BLD_07,
      },
    ],
    processed: false,
  },
];

const STATUS_STYLE = {
  Mapped: { bg: "var(--success-soft)", fg: "var(--success)" },
  "Partially Mapped": { bg: "var(--amber-soft)", fg: "var(--amber)" },
  "Not Mapped": { bg: "var(--line)", fg: "var(--ink-soft)" },
};

/* ---------------------------- SMALL UI ATOMS ---------------------------- */

function Tag({ children, tone = "muted" }) {
  const tones = {
    muted: { bg: "var(--line)", fg: "var(--ink-soft)" },
    primary: { bg: "var(--primary-soft)", fg: "var(--primary-dark)" },
  };
  const t = tones[tone];
  return (
    <span className="tag" style={{ background: t.bg, color: t.fg }}>
      {children}
    </span>
  );
}

function StatusPill({ status }) {
  const s = STATUS_STYLE[status] || STATUS_STYLE["Not Mapped"];
  return (
    <span className="status-pill" style={{ background: s.bg, color: s.fg }}>
      <span className="status-dot" style={{ background: s.fg }} />
      {status}
    </span>
  );
}

function FieldList({ items }) {
  return (
    <div className="field-list">
      {items.map((it, i) => (
        <div className="field-row" key={i}>
          <span className="field-label">{it.label}</span>
          <span className="field-value" style={it.mono ? { fontFamily: "var(--font-mono)" } : undefined}>
            {it.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function Panel({ title, action, children, style }) {
  return (
    <div className="panel" style={style}>
      {(title || action) && (
        <div className="panel-head">
          {title && <h3>{title}</h3>}
          {action}
        </div>
      )}
      <div className="panel-body">{children}</div>
    </div>
  );
}

function Button({ children, onClick, variant = "primary", disabled, icon: Icon, size = "md" }) {
  return (
    <button className={`btn btn-${variant} btn-${size}`} onClick={onClick} disabled={disabled}>
      {Icon && <Icon size={15} />}
      {children}
    </button>
  );
}

function AnimatedNumber({ value }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    let raf;
    const start = performance.now();
    const from = display;
    const duration = 500;
    function tick(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + (value - from) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return <>{display}</>;
}

/* ---------------------------- TOASTS ---------------------------- */

function ToastStack({ toasts }) {
  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          <CheckCircle2 size={15} />
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------- NAV / TOPBAR ---------------------------- */

const NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "records", label: "Records", icon: Files },
  { id: "map2d", label: "2D Map", icon: MapIcon },
  { id: "viewer3d", label: "3D Area Viewer", icon: BoxIcon },
  { id: "sources", label: "Data Sources", icon: Database },
  { id: "processing", label: "Processing", icon: Cpu },
  { id: "reports", label: "Reports", icon: ClipboardList },
];

function NavRail({ view, setView }) {
  return (
    <div className="navrail">
      <div className="brand">
        <div className="brand-mark">V3D</div>
        <div className="brand-text">
          <div className="brand-name">Vistaar3D</div>
          <div className="brand-sub">Team TwinSpark</div>
        </div>
      </div>
      <nav className="navlist">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = view === item.id;
          return (
            <button key={item.id} className={`navitem${active ? " active" : ""}`} onClick={() => setView(item.id)}>
              <Icon size={17} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
      <div className="navfoot">
        <Compass size={14} />
        <span>Vertical Property Mapping</span>
      </div>
    </div>
  );
}

const PAGE_TITLES = {
  dashboard: "Dashboard",
  records: "Records",
  map2d: "2D Map",
  viewer3d: "3D Area Viewer",
  sources: "Data Sources",
  processing: "Processing Workflow",
  reports: "Reports",
};

function TopBar({ view, selectedArea, onReset }) {
  return (
    <div className="topbar">
      <div className="crumb">
        <span>Vistaar3D</span>
        <ChevronRight size={13} />
        <span className="crumb-current">{PAGE_TITLES[view]}</span>
        {selectedArea && (
          <>
            <ChevronRight size={13} />
            <span className="crumb-current">{selectedArea.name}</span>
          </>
        )}
      </div>
      <div className="topbar-right">
        <Tag tone="primary">Team TwinSpark</Tag>
        <button className="btn btn-ghost btn-sm" onClick={onReset}>
          <RotateCcw size={13} /> Reset
        </button>
      </div>
    </div>
  );
}

/* ---------------------------- DASHBOARD ---------------------------- */

function Dashboard({ areas, selectedArea, processing, allSourcesLoaded, ulpinCount, goTo }) {
  const processedCount = areas.filter((a) => a.processed).length;
  const totalBuildings = areas.reduce((s, a) => s + a.parcels.length, 0);
  return (
    <div className="page">
      <div className="page-intro">
        <h1>Vistaar3D Workflow</h1>
        <p>
          Select a geographical area on the 2D map, generate the complete area in 3D with every
          building inside it, then drill down into one building's floors and vertical ULPIN.
        </p>
      </div>

      <div className="grid-4">
        <Panel title="Areas Available">
          <div className="stat-big"><AnimatedNumber value={areas.length} /></div>
          <div className="stat-caption">{totalBuildings} buildings across all areas</div>
        </Panel>
        <Panel title="Selected Area">
          <div className="stat-big" style={{ fontFamily: "var(--font-mono)", fontSize: 20 }}>
            {selectedArea ? selectedArea.code : "—"}
          </div>
          <div className="stat-caption">{selectedArea ? `${selectedArea.name}, ${selectedArea.district}` : "No area selected yet"}</div>
        </Panel>
        <Panel title="Data Source Status">
          <div className="stat-big">{allSourcesLoaded ? "Ready" : "Pending"}</div>
          <div className="stat-caption">{allSourcesLoaded ? "All 6 data sources loaded" : "Load data sources to continue"}</div>
        </Panel>
        <Panel title="Processing Status">
          <div className="stat-big" style={{ textTransform: "capitalize" }}>
            {processing.status === "done" ? "Model Ready" : processing.status}
          </div>
          <div className="stat-caption">{processedCount} of {areas.length} areas have a 3D model · {ulpinCount} ULPIN(s) generated</div>
        </Panel>
      </div>

      <div className="grid-2" style={{ marginTop: 20 }}>
        <Panel title="Suggested Flow">
          <ol className="flow-list">
            <li><b>2D Map</b> — select a geographical area and review its boundary.</li>
            <li><b>Data Sources</b> — load the drone, LiDAR, GIS and survey datasets.</li>
            <li><b>Processing</b> — run the building extraction → floor segmentation pipeline for the whole area.</li>
            <li><b>3D Area Viewer</b> — see every building in the area, click one to focus on it.</li>
            <li><b>Select a Floor</b> — inspect floor-level details inside the focused building.</li>
            <li><b>Generate 3D ULPIN</b> — assign a vertical identifier to a selected unit.</li>
          </ol>
        </Panel>
        <Panel title="Concept">
          <div className="concept-chain">
            {["2D Area", "Multiple Buildings", "Focus Building", "Floor Selection", "3D ULPIN"].map((s, i, arr) => (
              <React.Fragment key={s}>
                <span className="concept-node">{s}</span>
                {i < arr.length - 1 && <ArrowRight size={14} className="concept-arrow" />}
              </React.Fragment>
            ))}
          </div>
          <p className="muted-text" style={{ marginTop: 14 }}>
            Vistaar3D extends a 2D area of parcels into a complete 3D locality block — every
            building inside it is individually selectable, and each floor of the fully-mapped
            building can be resolved down to a vertical ULPIN.
          </p>
          <Button variant="primary" icon={ArrowRight} onClick={() => goTo("map2d")}>
            Start on the 2D map
          </Button>
        </Panel>
      </div>
    </div>
  );
}

/* ---------------------------- RECORDS ---------------------------- */

function Records({ areas, selectedAreaId, setSelectedAreaId, goTo }) {
  const selected = areas.find((a) => a.id === selectedAreaId) || areas[0];
  return (
    <div className="page">
      <div className="page-intro">
        <h1>Records</h1>
        <p>Existing 2D cadastral areas used as the starting point for 3D area generation.</p>
      </div>
      <div className="split-layout">
        <div className="record-list">
          {areas.map((a) => (
            <button
              key={a.id}
              className={`record-card${selected?.id === a.id ? " active" : ""}`}
              onClick={() => setSelectedAreaId(a.id)}
            >
              <div className="record-card-top">
                <span className="mono-strong">{a.code}</span>
                <StatusPill status={a.processed ? "Mapped" : "Not Mapped"} />
              </div>
              <div className="record-card-loc">
                <MapPin size={13} /> {a.name}, {a.district}, {a.state}
              </div>
              <div className="record-card-foot">
                <span>{a.parcels.length} buildings</span>
              </div>
            </button>
          ))}
        </div>

        {selected && (
          <Panel title="Area Details" style={{ flex: 1 }}>
            <FieldList
              items={[
                { label: "Area Code", value: selected.code, mono: true },
                { label: "Name", value: selected.name },
                { label: "District", value: selected.district },
                { label: "State", value: selected.state },
                { label: "Coordinates", value: selected.coordinates, mono: true },
                { label: "Total Buildings", value: selected.parcels.length },
                { label: "Total Parcel Area", value: `${selected.parcels.reduce((s, p) => s + p.areaSqm, 0)} m²` },
              ]}
            />

            <div className="records-building-list">
              {selected.parcels.map((p) => (
                <div className="records-building-row" key={p.id}>
                  <span className="mono-strong-sm">{p.building.id}</span>
                  <span>{p.building.type}</span>
                  <span>{p.building.floors.length} floors</span>
                </div>
              ))}
            </div>

            <div className="btn-row">
              <Button variant="secondary" icon={MapIcon} onClick={() => goTo("map2d")}>
                Open 2D Map
              </Button>
              <Button
                variant="primary"
                icon={BoxIcon}
                onClick={() => goTo(selected.processed ? "viewer3d" : "processing")}
              >
                {selected.processed ? "View 3D Area" : "Generate 3D Area"}
              </Button>
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}

/* ---------------------------- 2D MAP ---------------------------- */

/* ---------------------------- AERIAL MAP RENDERING (canvas, procedural) ---------------------------- */

// Deterministic seeded PRNG so the generated "aerial texture" is stable
// across re-renders instead of jittering every time React repaints.
function seedFromString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

const ROOF_PALETTE = ["#b7ae97", "#a4816a", "#8f8f84", "#c3b9a1", "#9d9c8e", "#ae9a7c"];

function drawAerialMap(ctx, w, h, area, selectedBuildingByArea) {
  ctx.clearRect(0, 0, w, h);
  const rand = mulberry32(seedFromString(area.id));

  // base terrain (mottled vegetation/soil, imitating an orthophoto)
  ctx.fillStyle = "#57623f";
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 55; i++) {
    const x = rand() * w, y = rand() * h, r = 8 + rand() * 26;
    ctx.fillStyle = `rgba(${60 + rand() * 30 | 0},${80 + rand() * 30 | 0},${42 + rand() * 18 | 0},${0.28 + rand() * 0.25})`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  for (let i = 0; i < 35; i++) {
    const x = rand() * w, y = rand() * h, r = 10 + rand() * 30;
    ctx.fillStyle = `rgba(${100 + rand() * 30 | 0},${86 + rand() * 20 | 0},${58 + rand() * 16 | 0},${0.16 + rand() * 0.18})`;
    ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.55, rand() * Math.PI, 0, Math.PI * 2); ctx.fill();
  }

  // unrelated "context" rooftops — background density, not individually tracked
  for (let i = 0; i < 26; i++) {
    const rw = 12 + rand() * 26, rh = 9 + rand() * 20;
    const x = rand() * w, y = rand() * h;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(((rand() * 24 - 12) * Math.PI) / 180);
    ctx.fillStyle = ROOF_PALETTE[(rand() * ROOF_PALETTE.length) | 0];
    ctx.fillRect(-rw / 2, -rh / 2, rw, rh);
    ctx.strokeStyle = "rgba(30,30,25,0.35)";
    ctx.lineWidth = 0.6;
    ctx.strokeRect(-rw / 2, -rh / 2, rw, rh);
    ctx.restore();
  }

  // area boundary
  ctx.beginPath();
  area.map2D.boundary.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
  ctx.strokeStyle = "#f2a93b";
  ctx.lineWidth = 1.8;
  ctx.setLineDash([6, 3]);
  ctx.stroke();
  ctx.setLineDash([]);

  // road (paved band, no boundary styling)
  const [ry1, ry2] = area.map2D.roadY;
  ctx.fillStyle = "#8f897a";
  ctx.fillRect(15, ry1, 310, ry2 - ry1);
  ctx.strokeStyle = "rgba(240,237,224,0.75)";
  ctx.lineWidth = 1.3;
  ctx.setLineDash([7, 6]);
  ctx.beginPath();
  ctx.moveTo(20, (ry1 + ry2) / 2);
  ctx.lineTo(315, (ry1 + ry2) / 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // tracked building footprints, with orange cadastral outlines + teal ID labels
  area.parcels.forEach((p, idx) => {
    const isSelected = selectedBuildingByArea[area.id] === p.id;
    ctx.beginPath();
    p.mapFootprint.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = isSelected ? "rgba(31,209,175,0.5)" : ROOF_PALETTE[idx % ROOF_PALETTE.length];
    ctx.fill();
    ctx.strokeStyle = isSelected ? "#0F5C4F" : "#f2a93b";
    ctx.lineWidth = isSelected ? 2.2 : 1.5;
    ctx.stroke();

    const lx = p.mapFootprint[0][0] + 3;
    const ly = p.mapFootprint[0][1] - 5;
    ctx.font = "italic 600 9px 'IBM Plex Mono', monospace";
    ctx.fillStyle = "rgba(10,20,18,0.75)";
    ctx.fillText(String((idx + 1) * 50 + 100), lx + 0.6, ly + 0.6);
    ctx.fillStyle = "#4fe0d6";
    ctx.fillText(String((idx + 1) * 50 + 100), lx, ly);
  });

  // north arrow
  ctx.save();
  ctx.translate(w - 34, 20);
  ctx.strokeStyle = "#f5f6f2"; ctx.fillStyle = "#f5f6f2"; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(0, 14); ctx.lineTo(0, 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-3.5, 7); ctx.lineTo(3.5, 7); ctx.closePath(); ctx.fill();
  ctx.font = "8px 'IBM Plex Sans', sans-serif"; ctx.textAlign = "center";
  ctx.fillText("N", 0, 26);
  ctx.restore();

  // scale bar
  ctx.save();
  ctx.translate(18, h - 16);
  ctx.strokeStyle = "#f5f6f2"; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(40, 0); ctx.stroke();
  ctx.font = "8px 'IBM Plex Sans', sans-serif"; ctx.textAlign = "center"; ctx.fillStyle = "#f5f6f2";
  ctx.fillText("~10 m", 20, -4);
  ctx.restore();
}

function AerialMapCanvas({ area, selectedBuildingByArea, onPickFootprint }) {
  const canvasRef = useRef(null);
  const W = 340, H = 260;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !area) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawAerialMap(ctx, W, H, area, selectedBuildingByArea);
    // Canvas text is baked in at draw time — if the custom web font hadn't
    // finished loading yet, redraw once it's ready so labels don't stay
    // stuck in a fallback font.
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        if (canvasRef.current === canvas) drawAerialMap(ctx, W, H, area, selectedBuildingByArea);
      });
    }
  }, [area, selectedBuildingByArea]);

  function findFootprintAt(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const y = ((e.clientY - rect.top) / rect.height) * H;
    return area.parcels.find((p) => pointInPolygon(x, y, p.mapFootprint));
  }

  function handleClick(e) {
    const hit = findFootprintAt(e);
    if (hit) onPickFootprint(hit.id);
  }
  function handleMove(e) {
    canvasRef.current.style.cursor = findFootprintAt(e) ? "pointer" : "default";
  }

  return <canvas ref={canvasRef} className="map-canvas-el" onClick={handleClick} onMouseMove={handleMove} />;
}

function Map2D({ areas, selectedAreaId, setSelectedAreaId, selectedBuildingByArea, setPreselectBuilding, goTo }) {
  const selected = areas.find((a) => a.id === selectedAreaId) || areas[0];

  return (
    <div className="page">
      <div className="page-intro">
        <h1>2D Map</h1>
        <p>Select an area to see every parcel and building footprint inside its boundary.</p>
      </div>
      <div className="split-layout">
        <Panel title="Cadastral View" style={{ flex: 1.4 }}>
          <div className="map-toolbar">
            {areas.map((a) => (
              <button
                key={a.id}
                className={`chip${selected?.id === a.id ? " chip-active" : ""}`}
                onClick={() => setSelectedAreaId(a.id)}
              >
                {a.code}
              </button>
            ))}
          </div>
          <div className="map-canvas">
            {selected && (
              <AerialMapCanvas
                area={selected}
                selectedBuildingByArea={selectedBuildingByArea}
                onPickFootprint={(parcelId) => setPreselectBuilding(selected.id, parcelId)}
              />
            )}
            <div className="map-legend">
              <div><span className="legend-swatch" style={{ background: "#f2a93b" }} /> Cadastral boundary</div>
              <div><span className="legend-swatch" style={{ background: "#b7ae97" }} /> Building rooftop</div>
              <div><span className="legend-swatch" style={{ background: "#8f897a" }} /> Road</div>
            </div>
          </div>
          <p className="muted-text" style={{ marginTop: 8 }}>Click a building footprint to pre-select it for the 3D viewer.</p>
        </Panel>

        {selected && (
          <Panel title="Selected Area" style={{ width: 320 }}>
            <FieldList
              items={[
                { label: "Area Code", value: selected.code, mono: true },
                { label: "Name", value: selected.name },
                { label: "District", value: selected.district },
                { label: "State", value: selected.state },
                { label: "Coordinates", value: selected.coordinates, mono: true },
                { label: "Buildings", value: selected.parcels.length },
              ]}
            />
            <Button
              variant="primary"
              icon={BoxIcon}
              onClick={() => goTo(selected.processed ? "viewer3d" : "processing")}
            >
              {selected.processed ? "View 3D Area" : "Generate 3D Area"}
            </Button>
          </Panel>
        )}
      </div>
    </div>
  );
}

/* ---------------------------- DATA SOURCES ---------------------------- */

function DataSources({ sourceStatus, loadSource, loadAll, allLoaded }) {
  return (
    <div className="page">
      <div className="page-intro">
        <h1>Data Sources</h1>
        <p>Spatial inputs used to build the 3D area model.</p>
      </div>
      <div className="btn-row" style={{ marginBottom: 16 }}>
        <Button variant="primary" onClick={loadAll} disabled={allLoaded}>
          {allLoaded ? "All Sources Loaded" : "Load All Sources"}
        </Button>
      </div>
      <div className="grid-3">
        {DATA_SOURCES.map((s) => {
          const Icon = s.icon;
          const status = sourceStatus[s.id];
          return (
            <Panel key={s.id}>
              <div className="source-head">
                <div className="source-icon"><Icon size={18} /></div>
                <div>
                  <div className="source-name">{s.name}</div>
                </div>
              </div>
              <p className="muted-text">{s.blurb}</p>
              <div className="source-meta">
                <span className="mono-strong-sm">{s.file}</span>
                <span>{s.size}</span>
              </div>
              <div className="source-foot">
                {status === "loaded" ? (
                  <span className="status-pill" style={{ background: "var(--success-soft)", color: "var(--success)" }}>
                    <CheckCircle2 size={13} /> Loaded
                  </span>
                ) : status === "loading" ? (
                  <span className="status-pill" style={{ background: "var(--line)", color: "var(--ink-soft)" }}>
                    <Loader2 size={13} className="spin" /> Loading…
                  </span>
                ) : (
                  <button className="btn btn-secondary btn-sm" onClick={() => loadSource(s.id)}>
                    Load Data
                  </button>
                )}
              </div>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------- PROCESSING ---------------------------- */

function Processing({ selectedArea, allSourcesLoaded, processing, startProcessing, goTo }) {
  const canStart = selectedArea && allSourcesLoaded && processing.status !== "running";

  return (
    <div className="page">
      <div className="page-intro">
        <h1>Processing Workflow</h1>
        <p>Pipeline that converts loaded spatial data into a complete multi-building 3D area model.</p>
      </div>

      <div className="split-layout">
        <Panel title="Pipeline" style={{ flex: 1.3 }}>
          <div className="pipeline">
            {PROCESSING_STEPS.map((step, i) => {
              const state =
                processing.status === "idle" ? "pending" :
                i < processing.stepIndex || processing.status === "done" ? "done" :
                i === processing.stepIndex && processing.status === "running" ? "active" : "pending";
              return (
                <div className={`pipeline-step state-${state}`} key={step.id}>
                  <div className="pipeline-marker">
                    {state === "done" && <CheckCircle2 size={16} />}
                    {state === "active" && <Loader2 size={16} className="spin" />}
                    {state === "pending" && <Circle size={16} />}
                  </div>
                  <div className="pipeline-body">
                    <div className="pipeline-label">{step.label}</div>
                    <div className="pipeline-detail">{step.detail}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>

        <Panel title="Run Processing" style={{ width: 320 }}>
          <FieldList
            items={[
              { label: "Area", value: selectedArea ? selectedArea.code : "None selected", mono: true },
              { label: "Buildings", value: selectedArea ? selectedArea.parcels.length : "—" },
              { label: "Data Sources", value: allSourcesLoaded ? "6 / 6 loaded" : "Incomplete" },
              { label: "Status", value: processing.status === "idle" ? "Not started" : processing.status === "running" ? "Running…" : "Complete" },
            ]}
          />
          <Button variant="primary" icon={Cpu} disabled={!canStart} onClick={startProcessing}>
            {processing.status === "running" ? "Processing…" : "Generate 3D Area"}
          </Button>
          {!selectedArea && (
            <p className="muted-text" style={{ marginTop: 10 }}>
              Select an area in <a onClick={() => goTo("map2d")}>2D Map</a> first.
            </p>
          )}
          {selectedArea && !allSourcesLoaded && (
            <p className="muted-text" style={{ marginTop: 10 }}>
              Load all data sources in <a onClick={() => goTo("sources")}>Data Sources</a> before running processing.
            </p>
          )}
          {processing.status === "done" && (
            <Button variant="secondary" icon={BoxIcon} onClick={() => goTo("viewer3d")}>
              Open 3D Area Viewer
            </Button>
          )}
        </Panel>
      </div>
    </div>
  );
}

/* ---------------------------- 3D SCENE HELPERS (raw three.js) ---------------------------- */

function layoutFloors(floors) {
  const sorted = [...floors].sort((a, b) => a.order - b.order);
  const below = sorted.filter((f) => f.belowGrade);
  const above = sorted.filter((f) => !f.belowGrade);
  const laid = [];
  let y = -below.reduce((s, f) => s + f.sceneHeight, 0);
  below.forEach((f) => { laid.push({ ...f, yBottom: y, yTop: y + f.sceneHeight }); y += f.sceneHeight; });
  y = 0;
  above.forEach((f) => { laid.push({ ...f, yBottom: y, yTop: y + f.sceneHeight }); y += f.sceneHeight; });
  return laid.sort((a, b) => a.order - b.order);
}

function lighten(hex, amt) {
  const c = new THREE.Color(hex);
  c.lerp(new THREE.Color(0xffffff), amt);
  return c.getHex();
}

function paintWindowGrid(ctx, x, y, w, h, cols, glassColor, frameColor) {
  const gap = w * 0.16;
  const cellW = (w - gap * (cols + 1)) / cols;
  const cellH = h * 0.62;
  const cellY = y + (h - cellH) / 2;
  for (let i = 0; i < cols; i++) {
    const cx = x + gap + i * (cellW + gap);
    const grad = ctx.createLinearGradient(cx, cellY, cx, cellY + cellH);
    grad.addColorStop(0, glassColor.top);
    grad.addColorStop(1, glassColor.bottom);
    ctx.fillStyle = grad;
    ctx.fillRect(cx, cellY, cellW, cellH);
    ctx.strokeStyle = frameColor;
    ctx.lineWidth = Math.max(1, w * 0.006);
    ctx.strokeRect(cx, cellY, cellW, cellH);
    ctx.beginPath();
    ctx.moveTo(cx + cellW / 2, cellY);
    ctx.lineTo(cx + cellW / 2, cellY + cellH);
    ctx.moveTo(cx, cellY + cellH * 0.5);
    ctx.lineTo(cx + cellW, cellY + cellH * 0.5);
    ctx.stroke();
    if (i % 2 === 0) {
      ctx.fillStyle = "#c7cbc3";
      ctx.fillRect(cx + cellW * 0.15, cellY + cellH + h * 0.03, cellW * 0.55, h * 0.07);
    }
  }
}

function paintShopfront(ctx, x, y, w, h, tint) {
  const glassH = h * 0.66;
  const grad = ctx.createLinearGradient(x, y, x, y + glassH);
  grad.addColorStop(0, "#dce9ef");
  grad.addColorStop(1, "#9fb9c4");
  ctx.fillStyle = grad;
  ctx.fillRect(x + w * 0.03, y + h * 0.28, w * 0.94, glassH);
  ctx.strokeStyle = "#2a332e";
  ctx.lineWidth = w * 0.008;
  const mullions = 4;
  for (let i = 1; i < mullions; i++) {
    const mx = x + w * 0.03 + (w * 0.94 * i) / mullions;
    ctx.beginPath();
    ctx.moveTo(mx, y + h * 0.28);
    ctx.lineTo(mx, y + h * 0.28 + glassH);
    ctx.stroke();
  }
  ctx.fillStyle = tint;
  ctx.fillRect(x, y, w, h * 0.22);
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.fillRect(x + w * 0.06, y + h * 0.08, w * 0.3, h * 0.06);
  ctx.fillStyle = "#4b5650";
  ctx.fillRect(x, y + h * 0.94, w, h * 0.06);
}

function paintBasement(ctx, x, y, w, h) {
  ctx.fillStyle = "#767f78";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "#5c655f";
  ctx.lineWidth = h * 0.05;
  for (let i = 0; i < 7; i++) {
    const yy = y + (h * (i + 0.5)) / 7;
    ctx.beginPath();
    ctx.moveTo(x + w * 0.04, yy);
    ctx.lineTo(x + w * 0.96, yy);
    ctx.stroke();
  }
}

function paintParapet(ctx, x, y, w, h) {
  ctx.fillStyle = "#cdd2c8";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#dfe3da";
  ctx.fillRect(x, y, w, h * 0.22);
}

function makeFacadeTexture(floor, widthUnits, heightUnits, isNarrowFace) {
  const px = 110;
  const w = Math.max(96, Math.round(widthUnits * px));
  const h = Math.max(64, Math.round(heightUnits * px));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");

  const wallColor = floor.propertyType === "Residential" ? "#e7e2d3" : floor.propertyType === "Commercial" ? "#efece3" : "#c7ccc2";
  ctx.fillStyle = wallColor;
  ctx.fillRect(0, 0, w, h);

  if (floor.propertyType === "Utility" && floor.belowGrade) {
    paintBasement(ctx, 0, 0, w, h);
  } else if (floor.propertyType === "Utility" && !floor.belowGrade) {
    paintParapet(ctx, 0, 0, w, h);
  } else if (floor.propertyType === "Commercial") {
    paintShopfront(ctx, 0, 0, w, h, "#0f5c4f");
  } else {
    const cols = isNarrowFace ? Math.max(2, Math.round(widthUnits * 1.1)) : Math.max(3, Math.round(widthUnits * 1.7));
    paintWindowGrid(ctx, 0, h * 0.1, w, h * 0.8, cols, { top: "#bcd6df", bottom: "#5f89a1" }, "#3a4640");
  }

  const grad = ctx.createLinearGradient(0, 0, 0, h * 0.08);
  grad.addColorStop(0, "rgba(0,0,0,0.18)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h * 0.08);

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

function buildFacadeMaterials(floor, footprintW, footprintD, height) {
  const wallColor = floor.propertyType === "Residential" ? 0xe7e2d3 : floor.propertyType === "Commercial" ? 0xefece3 : 0xc7ccc2;
  const wideTex = makeFacadeTexture(floor, footprintW, height, false);
  const narrowTex = makeFacadeTexture(floor, footprintD, height, true);
  const plain = new THREE.MeshStandardMaterial({ color: wallColor, roughness: 0.88, metalness: 0.02 });
  const wideMat = new THREE.MeshStandardMaterial({ map: wideTex, roughness: 0.55, metalness: 0.05 });
  const narrowMat = new THREE.MeshStandardMaterial({ map: narrowTex, roughness: 0.55, metalness: 0.05 });
  return [narrowMat, narrowMat, plain, plain, wideMat, wideMat];
}

function makeTextSprite(text, { size = 64, color = "#1e2723", weight = "700", bg = null, scale = 1 } = {}) {
  const canvas = document.createElement("canvas");
  const probe = canvas.getContext("2d");
  probe.font = `${weight} ${size}px 'IBM Plex Sans', sans-serif`;
  const pad = 12;
  const textWidth = probe.measureText(text).width;
  canvas.width = Math.ceil(textWidth + pad * 2);
  canvas.height = size + pad * 2;
  const ctx = canvas.getContext("2d");
  ctx.font = `${weight} ${size}px 'IBM Plex Sans', sans-serif`;
  if (bg) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 1);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  const aspect = canvas.width / canvas.height;
  const h = 0.4 * scale;
  sprite.scale.set(h * aspect, h, 1);
  sprite.renderOrder = 10;
  return sprite;
}

// Builds every mesh for one building (floors, slabs, balconies, canopy, core,
// tank), positioned inside its own THREE.Group. Returns { group, floorMeshes,
// totalTop, totalBottom, coreH }.
function buildBuildingGroup(parcel) {
  const building = parcel.building;
  const laidFloors = layoutFloors(building.floors);
  const footprintW = parcel.footprintW;
  const footprintD = parcel.footprintD;
  const group = new THREE.Group();
  const floorMeshes = [];
  const slabColor = new THREE.MeshStandardMaterial({ color: 0xcfd2c8, roughness: 0.75 });

  laidFloors.forEach((f) => {
    const h = f.yTop - f.yBottom;
    const scale = f.footprintScale || 1;
    const w = footprintW * scale;
    const d = footprintD * scale;
    const geo = new THREE.BoxGeometry(w, h, d);
    const materials = buildFacadeMaterials(f, w, d, h);
    const mesh = new THREE.Mesh(geo, materials);
    mesh.position.set(0, f.yBottom + h / 2, 0);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = {
      buildingId: building.id,
      floorId: f.id,
      baseColors: materials.map((m) => m.color.getHex()),
      baseY: mesh.position.y,
    };
    group.add(mesh);
    floorMeshes.push(mesh);

    const slab = new THREE.Mesh(new THREE.BoxGeometry(w + 0.06, 0.06, d + 0.06), slabColor);
    slab.position.set(0, f.yBottom, 0);
    slab.castShadow = true;
    slab.receiveShadow = true;
    group.add(slab);

    if (f.propertyType === "Residential") {
      const balcony = new THREE.Mesh(new THREE.BoxGeometry(w * 0.72, 0.06, 0.3), slabColor);
      balcony.position.set(0, f.yBottom + 0.04, d / 2 + 0.15);
      balcony.castShadow = true;
      group.add(balcony);
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(w * 0.72, 0.28, 0.02),
        new THREE.MeshStandardMaterial({ color: 0x8b9a90, roughness: 0.5, metalness: 0.3, transparent: true, opacity: 0.55 })
      );
      rail.position.set(0, f.yBottom + 0.04 + 0.17, d / 2 + 0.3);
      group.add(rail);
    }
  });

  const groundFloor = laidFloors.find((f) => f.propertyType === "Commercial") || laidFloors[0];
  if (groundFloor) {
    const canopy = new THREE.Mesh(
      new THREE.BoxGeometry(footprintW * 0.5, 0.05, 0.42),
      new THREE.MeshStandardMaterial({ color: 0x0f5c4f, roughness: 0.5 })
    );
    canopy.position.set(0, groundFloor.yTop - 0.13, footprintD / 2 + 0.24);
    canopy.castShadow = true;
    group.add(canopy);
  }

  const totalTop = laidFloors.reduce((m, f) => Math.max(m, f.yTop), 0);
  const totalBottom = laidFloors.reduce((m, f) => Math.min(m, f.yBottom), 0);
  const coreH = totalTop - totalBottom;
  const core = new THREE.Mesh(
    new THREE.BoxGeometry(Math.min(0.5, footprintW * 0.18), coreH, Math.min(0.45, footprintD * 0.18)),
    new THREE.MeshStandardMaterial({ color: 0xb7bcb1, roughness: 0.85 })
  );
  core.position.set(footprintW * 0.5 + 0.04, totalBottom + coreH / 2, -footprintD * 0.15);
  core.castShadow = true;
  core.receiveShadow = true;
  group.add(core);

  const topFloor = laidFloors[laidFloors.length - 1];
  const tank = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.28, 0.34),
    new THREE.MeshStandardMaterial({ color: 0xd8dcd2, roughness: 0.8 })
  );
  tank.position.set(-footprintW * 0.28, topFloor.yTop + 0.14, footprintD * 0.15);
  tank.castShadow = true;
  group.add(tank);

  group.position.set(parcel.position.x, 0, parcel.position.z);

  return { group, floorMeshes, totalTop, totalBottom, coreH };
}

/* ---------------------------- 3D AREA CANVAS ---------------------------- */

const AreaCanvas3D = forwardRef(function AreaCanvas3D(
  { area, selectedBuildingId, selectedFloorId, hoveredFloorId, onHoverFloor, onPick, onHeadingChange },
  ref
) {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const needleRef = useRef(null);
  const stateRef = useRef({ selectedBuildingId, selectedFloorId, hoveredFloorId });
  // Callback props are recreated every render, but the scene-init effect
  // below only re-runs when `area` changes — so event handlers must call
  // through these refs (kept fresh every render) rather than closing over
  // the props directly, or they'd keep calling a stale, outdated callback.
  const onPickRef = useRef(onPick);
  const onHoverFloorRef = useRef(onHoverFloor);
  const onHeadingChangeRef = useRef(onHeadingChange);
  useEffect(() => {
    onPickRef.current = onPick;
    onHoverFloorRef.current = onHoverFloor;
    onHeadingChangeRef.current = onHeadingChange;
  });

  useEffect(() => {
    stateRef.current = { selectedBuildingId, selectedFloorId, hoveredFloorId };
  }, [selectedBuildingId, selectedFloorId, hoveredFloorId]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let width = mount.clientWidth || 600;
    let height = mount.clientHeight || 420;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xeef1ea);
    scene.fog = new THREE.Fog(0xeef1ea, 18, 34);

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    if ("outputColorSpace" in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;
    else renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    mount.appendChild(renderer.domElement);

    const hemi = new THREE.HemisphereLight(0xdfeaf0, 0x9a9184, 0.75);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff3e0, 1.15);
    sun.position.set(10, 15, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 45;
    sun.shadow.camera.left = -12;
    sun.shadow.camera.right = 12;
    sun.shadow.camera.top = 12;
    sun.shadow.camera.bottom = -12;
    sun.shadow.bias = -0.0015;
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xbfd9cf, 0.25);
    fill.position.set(-8, 6, -7);
    scene.add(fill);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(18, 48),
      new THREE.MeshStandardMaterial({ color: 0xd9dcd2, roughness: 0.95 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.01;
    ground.receiveShadow = true;
    scene.add(ground);
    const grid = new THREE.GridHelper(30, 30, 0xb9c0b3, 0xcfd4c8);
    grid.material.opacity = 0.5;
    grid.material.transparent = true;
    scene.add(grid);

    // ---- area boundary + fill ----
    const boundary = area.scene3D.boundary;
    const pts3d = boundary.map(([x, z]) => new THREE.Vector3(x, 0.015, z));
    pts3d.push(pts3d[0].clone());
    const boundaryLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts3d),
      new THREE.LineDashedMaterial({ color: 0x0f5c4f, dashSize: 0.16, gapSize: 0.1 })
    );
    boundaryLine.computeLineDistances();
    scene.add(boundaryLine);

    const shape = new THREE.Shape(boundary.map(([x, z]) => new THREE.Vector2(x, -z)));
    const fillMesh = new THREE.Mesh(
      new THREE.ShapeGeometry(shape),
      new THREE.MeshBasicMaterial({ color: 0x0f5c4f, transparent: true, opacity: 0.04, side: THREE.DoubleSide })
    );
    fillMesh.rotation.x = -Math.PI / 2;
    fillMesh.position.y = 0.012;
    scene.add(fillMesh);

    // ---- road through the middle of the area ----
    const bboxMinX = Math.min(...boundary.map((p) => p[0]));
    const bboxMaxX = Math.max(...boundary.map((p) => p[0]));
    const roadSpan = bboxMaxX - bboxMinX + 2.4;
    const roadZ = area.scene3D.roadZ;
    const roadW = area.scene3D.roadWidth;
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(roadSpan, roadW),
      new THREE.MeshStandardMaterial({ color: 0x555a54, roughness: 0.95 })
    );
    road.rotation.x = -Math.PI / 2;
    road.position.set((bboxMinX + bboxMaxX) / 2, 0.008, roadZ);
    road.receiveShadow = true;
    scene.add(road);
    const roadLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(bboxMinX - 0.8, 0.012, roadZ),
        new THREE.Vector3(bboxMaxX + 0.8, 0.012, roadZ),
      ]),
      new THREE.LineDashedMaterial({ color: 0xe4e0c8, dashSize: 0.22, gapSize: 0.16 })
    );
    roadLine.computeLineDistances();
    scene.add(roadLine);

    // ---- every building in the area ----
    const allFloorMeshes = [];
    const buildingInfos = {}; // buildingId -> { group, totalTop, totalBottom, coreH, position, footprintW, footprintD }
    area.parcels.forEach((parcel) => {
      const built = buildBuildingGroup(parcel);
      scene.add(built.group);
      allFloorMeshes.push(...built.floorMeshes);
      buildingInfos[parcel.building.id] = {
        ...built,
        position: parcel.position,
        footprintW: parcel.footprintW,
        footprintD: parcel.footprintD,
      };
    });

    // Only the focused building (or every building, if none is focused) is
    // visible at all — clicking a building hides every other one completely,
    // and "Back to Area" / switching focus brings them back.
    function applyFocusVisibility(buildingId) {
      Object.keys(buildingInfos).forEach((id) => {
        buildingInfos[id].group.visible = !buildingId || id === buildingId;
      });
    }
    applyFocusVisibility(selectedBuildingId);

    // Raycasting against a flat mesh array doesn't reliably respect an
    // ancestor group's `visible` flag, so explicitly exclude hidden
    // buildings' meshes from hit-testing rather than relying on that alone.
    function pickableMeshes() {
      const focusId = stateRef.current.selectedBuildingId;
      if (!focusId) return allFloorMeshes;
      return allFloorMeshes.filter((m) => m.userData.buildingId === focusId);
    }

    // ---- compass: fixed at the centre of the whole area ----
    const areaSpanX = bboxMaxX - bboxMinX;
    const bboxMinZ = Math.min(...boundary.map((p) => p[1]));
    const bboxMaxZ = Math.max(...boundary.map((p) => p[1]));
    const compassRadius = Math.max(areaSpanX, bboxMaxZ - bboxMinZ) * 0.62 + 1.2;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(compassRadius - 0.03, compassRadius, 64),
      new THREE.MeshBasicMaterial({ color: 0xaeb6a8, side: THREE.DoubleSide, transparent: true, opacity: 0.32 })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.006;
    scene.add(ring);
    [
      { label: "N", x: 0, z: -compassRadius - 0.5, color: "#0f5c4f", scale: 1.3 },
      { label: "S", x: 0, z: compassRadius + 0.45, color: "#4b564f", scale: 1 },
      { label: "E", x: compassRadius + 0.45, z: 0, color: "#4b564f", scale: 1 },
      { label: "W", x: -compassRadius - 0.45, z: 0, color: "#4b564f", scale: 1 },
    ].forEach((c) => {
      const sprite = makeTextSprite(c.label, { size: 74, color: c.color, scale: c.scale });
      sprite.position.set(c.x, 0.42, c.z);
      scene.add(sprite);
    });

    // ---- elevation ruler group: (re)built dynamically for whichever building is focused ----
    const rulerGroup = new THREE.Group();
    scene.add(rulerGroup);
    function rebuildRuler(buildingId) {
      rulerGroup.clear();
      if (!buildingId) return;
      const info = buildingInfos[buildingId];
      if (!info) return;
      const laid = layoutFloors(area.parcels.find((p) => p.building.id === buildingId).building.floors);
      const rulerX = info.position.x - (info.footprintW / 2 + 0.85);
      const rulerZ = info.position.z - (info.footprintD / 2 + 0.3);
      const rulerMat = new THREE.LineBasicMaterial({ color: 0x8b9389 });
      rulerGroup.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(rulerX, info.totalBottom, rulerZ),
            new THREE.Vector3(rulerX, info.totalTop, rulerZ),
          ]),
          rulerMat
        )
      );
      const tickYs = new Set([info.totalBottom]);
      laid.forEach((f) => tickYs.add(f.yTop));
      [...tickYs].forEach((y) => {
        rulerGroup.add(
          new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([
              new THREE.Vector3(rulerX - 0.08, y, rulerZ),
              new THREE.Vector3(rulerX + 0.08, y, rulerZ),
            ]),
            rulerMat
          )
        );
      });
      laid.forEach((f) => {
        const label = makeTextSprite(f.elevationLabel, { size: 40, color: "#1e2723", bg: "rgba(255,255,255,0.88)", scale: 0.6 });
        label.position.set(rulerX - 0.55, f.yBottom + (f.yTop - f.yBottom) / 2, rulerZ);
        rulerGroup.add(label);
      });
    }
    rebuildRuler(selectedBuildingId);

    // ---- camera: orbit around a goal that animates between area-overview and building-focus ----
    const areaCenter = new THREE.Vector3((bboxMinX + bboxMaxX) / 2, 0.6, (bboxMinZ + bboxMaxZ) / 2);
    const areaRadius = Math.max(areaSpanX, bboxMaxZ - bboxMinZ) * 1.15 + 3;
    const AREA_DEFAULTS = { radius: areaRadius, theta: Math.PI / 4, phi: Math.PI / 3.4, target: areaCenter.clone() };

    function focusParamsFor(buildingId) {
      if (!buildingId) return AREA_DEFAULTS;
      const info = buildingInfos[buildingId];
      if (!info) return AREA_DEFAULTS;
      const r = Math.max(info.footprintW, info.footprintD) * 2.1 + info.coreH * 0.35 + 2.2;
      return {
        radius: r,
        theta: Math.PI / 4,
        phi: Math.PI / 3.2,
        target: new THREE.Vector3(info.position.x, info.totalBottom + info.coreH / 2, info.position.z),
      };
    }

    const cam = { radius: AREA_DEFAULTS.radius, theta: AREA_DEFAULTS.theta, phi: AREA_DEFAULTS.phi, target: AREA_DEFAULTS.target.clone() };
    const camGoal = { radius: cam.radius, theta: cam.theta, phi: cam.phi, target: cam.target.clone() };

    function setCamGoal(buildingId) {
      const p = focusParamsFor(buildingId);
      camGoal.radius = p.radius;
      camGoal.theta = p.theta;
      camGoal.phi = p.phi;
      camGoal.target.copy(p.target);
    }
    setCamGoal(selectedBuildingId);

    function updateCamera() {
      camera.position.x = cam.target.x + cam.radius * Math.sin(cam.phi) * Math.sin(cam.theta);
      camera.position.y = cam.target.y + cam.radius * Math.cos(cam.phi);
      camera.position.z = cam.target.z + cam.radius * Math.sin(cam.phi) * Math.cos(cam.theta);
      camera.lookAt(cam.target);
    }
    updateCamera();

    const raycaster = new THREE.Raycaster();
    const mouseNDC = new THREE.Vector2(10, 10);
    let dragging = false, moved = false, lastX = 0, lastY = 0;
    let lastHover = null;
    let userTheta = null; // once the user drags, stop forcing theta from the focus goal

    function setMouseFromEvent(e) {
      const rect = renderer.domElement.getBoundingClientRect();
      mouseNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouseNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    }

    function onPointerDown(e) {
      dragging = true; moved = false;
      lastX = e.clientX; lastY = e.clientY;
      renderer.domElement.setPointerCapture(e.pointerId);
    }
    function onPointerMove(e) {
      setMouseFromEvent(e);
      if (dragging) {
        const dx = e.clientX - lastX, dy = e.clientY - lastY;
        if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
        cam.theta -= dx * 0.0075;
        camGoal.theta = cam.theta;
        cam.phi = Math.min(Math.max(cam.phi - dy * 0.0075, 0.35), Math.PI / 2.1);
        camGoal.phi = cam.phi;
        lastX = e.clientX; lastY = e.clientY;
      }
    }
    function onPointerUp() {
      dragging = false;
      if (!moved) {
        raycaster.setFromCamera(mouseNDC, camera);
        const hits = raycaster.intersectObjects(pickableMeshes());
        if (hits.length) {
          const ud = hits[0].object.userData;
          onPickRef.current(ud.buildingId, ud.floorId);
        }
      }
    }
    function onWheel(e) {
      e.preventDefault();
      cam.radius = Math.min(Math.max(cam.radius + e.deltaY * 0.012, 3.5), areaRadius + 6);
      camGoal.radius = cam.radius;
    }
    function onLeave() {
      mouseNDC.set(10, 10);
      if (lastHover !== null) { lastHover = null; onHoverFloorRef.current(null); }
    }

    const el = renderer.domElement;
    el.style.touchAction = "none";
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerleave", onLeave);

    const tmpColor = new THREE.Color();
    const selectTint = new THREE.Color(0x1fd1af);
    const selectEmissive = new THREE.Color(0x0b3b33);
    const black = new THREE.Color(0x000000);

    let rafId;
    let frameCount = 0;
    let lastFocusedId = selectedBuildingId;
    function animate() {
      rafId = requestAnimationFrame(animate);

      // camera easing toward the current goal
      cam.radius += (camGoal.radius - cam.radius) * 0.09;
      if (!dragging) {
        cam.theta += (camGoal.theta - cam.theta) * 0.06;
        cam.phi += (camGoal.phi - cam.phi) * 0.06;
      }
      cam.target.lerp(camGoal.target, 0.09);
      updateCamera();

      if (!dragging) {
        raycaster.setFromCamera(mouseNDC, camera);
        const hits = raycaster.intersectObjects(pickableMeshes());
        const hit = hits.length ? hits[0].object.userData : null;
        const hitId = hit ? hit.floorId : null;
        if (hitId !== lastHover) { lastHover = hitId; onHoverFloorRef.current(hitId); }
        el.style.cursor = hitId ? "pointer" : "grab";
      } else {
        el.style.cursor = "grabbing";
      }

      const { selectedBuildingId: focusId, selectedFloorId: selId, hoveredFloorId: hovId } = stateRef.current;
      if (focusId !== lastFocusedId) {
        lastFocusedId = focusId;
        rebuildRuler(focusId);
        applyFocusVisibility(focusId);
      }

      allFloorMeshes.forEach((mesh) => {
        const { buildingId, floorId } = mesh.userData;
        if (buildingInfos[buildingId] && !buildingInfos[buildingId].group.visible) return; // hidden — nothing to update
        const isSelected = floorId === selId;
        const isHovered = floorId === hovId;
        const targetPosY = mesh.userData.baseY + (isSelected ? 0.06 : 0);
        mesh.position.y += (targetPosY - mesh.position.y) * 0.18;

        mesh.material.forEach((mat, i) => {
          tmpColor.setHex(mesh.userData.baseColors[i]);
          if (isSelected) {
            tmpColor.lerp(selectTint, 0.55);
          } else if (isHovered) {
            tmpColor.lerp(new THREE.Color(0xffffff), 0.3);
          }
          mat.color.lerp(tmpColor, 0.15);
          mat.emissive.lerp(isSelected ? selectEmissive : black, 0.15);
        });
      });

      renderer.render(scene, camera);

      if (needleRef.current) {
        const deg = THREE.MathUtils.radToDeg(cam.theta) % 360;
        needleRef.current.style.transform = `rotate(${deg}deg)`;
      }
      frameCount++;
      if (onHeadingChangeRef.current && frameCount % 8 === 0) {
        const bearing = Math.round(((THREE.MathUtils.radToDeg(cam.theta) % 360) + 360) % 360);
        onHeadingChangeRef.current(bearing);
      }
    }
    animate();

    function onResize() {
      width = mount.clientWidth || width;
      height = mount.clientHeight || height;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    }
    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(mount);

    sceneRef.current = {
      camGoal,
      cam,
      setCamGoal,
      areaDefaults: AREA_DEFAULTS,
      focusParamsFor,
    };

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerleave", onLeave);
      mount.removeChild(el);
      allFloorMeshes.forEach((m) => {
        m.geometry.dispose();
        (Array.isArray(m.material) ? m.material : [m.material]).forEach((mat) => {
          if (mat.map) mat.map.dispose();
          mat.dispose();
        });
      });
      renderer.dispose();
    };
  }, [area]);

  // when the selected building changes (click in area or "Back to Area"),
  // retarget the camera goal — the animate loop eases toward it every frame
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    s.setCamGoal(selectedBuildingId);
  }, [selectedBuildingId]);

  useImperativeHandle(ref, () => ({
    resetView() {
      const s = sceneRef.current;
      if (!s) return;
      s.setCamGoal(stateRef.current.selectedBuildingId);
    },
    zoomIn() {
      const s = sceneRef.current;
      if (!s) return;
      s.camGoal.radius = Math.max(3.5, s.camGoal.radius - 1.3);
      s.cam.radius = s.camGoal.radius;
    },
    zoomOut() {
      const s = sceneRef.current;
      if (!s) return;
      s.camGoal.radius = s.camGoal.radius + 1.3;
      s.cam.radius = s.camGoal.radius;
    },
    backToArea() {
      const s = sceneRef.current;
      if (!s) return;
      s.setCamGoal(null);
    },
  }));

  return (
    <div className="canvas3d-wrap">
      <div ref={mountRef} className="canvas3d" />
      <div className="compass-hud" title="Orientation — N shown relative to the current view">
        <div ref={needleRef} className="compass-face">
          <span className="compass-arrow" />
          <span className="compass-n">N</span>
        </div>
      </div>
    </div>
  );
});

/* ---------------------------- FLOOR PLAN SVG ---------------------------- */

function FloorPlanSVG({ floor }) {
  const n = floor.units.length;
  const pad = 14, w = 260, h = 150;
  const gap = 6;
  const cellW = n > 1 ? (w - pad * 2 - gap * (n - 1)) / n : w - pad * 2;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="floorplan-svg">
      <rect x="4" y="4" width={w - 8} height={h - 8} fill="#FFFFFF" stroke="#DBE0D6" strokeWidth="2" />
      {floor.units.map((u, i) => (
        <g key={u.id} transform={`translate(${pad + i * (cellW + gap)}, ${pad})`}>
          <rect width={cellW} height={h - pad * 2} fill="var(--primary-soft)" stroke="#0F5C4F" strokeWidth="1.4" />
          <text x={cellW / 2} y={(h - pad * 2) / 2 - 6} textAnchor="middle" className="fp-label">{u.label}</text>
          <text x={cellW / 2} y={(h - pad * 2) / 2 + 12} textAnchor="middle" className="fp-sub">{u.areaSqm} m²</text>
        </g>
      ))}
    </svg>
  );
}

/* ---------------------------- 3D AREA VIEWER PAGE ---------------------------- */

function Viewer3D({ area, selectedBuildingId, setSelectedBuildingId, selectedFloorId, setSelectedFloorId, generatedUlpins, generateUlpin, goTo }) {
  const [hoveredFloorId, setHoveredFloorId] = useState(null);
  const [activeUnitId, setActiveUnitId] = useState(null);
  const [ulpinAnim, setUlpinAnim] = useState(null);
  const [heading, setHeading] = useState(45);
  const [expanded, setExpanded] = useState(false);
  const canvasApiRef = useRef(null);

  useEffect(() => {
    if (!expanded) return;
    function onKey(e) {
      if (e.key === "Escape") setExpanded(false);
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [expanded]);

  const parcel = area?.parcels.find((p) => p.building.id === selectedBuildingId) || null;
  const building = parcel?.building || null;
  const floors = building?.floors || [];
  const selectedFloor = floors.find((f) => f.id === selectedFloorId);
  const hoveredFloor = floors.find((f) => f.id === hoveredFloorId);

  useEffect(() => {
    if (selectedFloor && selectedFloor.units && selectedFloor.units.length && !selectedFloor.units.find((u) => u.id === activeUnitId)) {
      setActiveUnitId(selectedFloor.units[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFloorId]);

  if (!area || !area.processed) {
    return (
      <div className="page">
        <div className="page-intro"><h1>3D Area Viewer</h1></div>
        <Panel>
          <div className="empty-state">
            <Info size={22} />
            <p>No processed 3D model is available yet. Select an area and run processing first.</p>
            <Button variant="primary" icon={Cpu} onClick={() => goTo("processing")}>Go to Processing</Button>
          </div>
        </Panel>
      </div>
    );
  }

  function handlePick(buildingId, floorId) {
    // Clicking any floor mesh both focuses its building (if not already
    // focused) AND selects that exact floor immediately — no need to click
    // the same floor twice after the camera focuses on a new building.
    if (buildingId !== selectedBuildingId) {
      setSelectedBuildingId(buildingId);
    }
    setSelectedFloorId(floorId);
    setActiveUnitId(null);
  }

  function backToArea() {
    setSelectedBuildingId(null);
    setSelectedFloorId(null);
    canvasApiRef.current?.backToArea();
  }

  const activeUnit = selectedFloor?.units?.find((u) => u.id === activeUnitId) || null;
  const generated = selectedFloor ? generatedUlpins[selectedFloor.id] : null;
  const ulpin3D = selectedFloor && activeUnit && parcel
    ? `${parcel.ulpin2D}-${building.code}-${selectedFloor.code}-${activeUnit.code}`
    : null;

  function handleGenerate() {
    if (!selectedFloor || !activeUnit) return;
    setUlpinAnim({ step: 0 });
    [1, 2, 3].forEach((s, i) => {
      setTimeout(() => setUlpinAnim({ step: s }), (i + 1) * 480);
    });
    setTimeout(() => {
      generateUlpin(selectedFloor.id, activeUnit.id, ulpin3D);
    }, 4 * 480);
  }

  return (
    <div className={`page${expanded ? " page-expanded" : ""}`}>
      {!expanded && (
        <div className="page-intro">
          <h1>3D Area Viewer</h1>
          <p>
            {selectedBuildingId
              ? "Click a floor to inspect it, or step back to see the whole area."
              : "Drag to rotate · scroll to zoom · click any building to focus on it."}
          </p>
        </div>
      )}

      <div className="split-layout">
        <Panel style={{ flex: 1.4, padding: 0 }}>
          <div className="viewer-caption">
            {selectedBuildingId ? (
              <button className="btn btn-ghost btn-sm" onClick={backToArea}>
                <ArrowLeft size={13} /> Back to Area
              </button>
            ) : (
              <>
                <Building2 size={14} />
                <span>{area.name} · {area.parcels.length} buildings</span>
              </>
            )}
            <span className="viewer-caption-geo mono-strong-sm">{area.coordinates}</span>
            <span className="viewer-hover-text">
              {hoveredFloor ? `Hovering: ${hoveredFloor.name}` : selectedBuildingId ? "Hover a floor to preview it" : "Hover or click a building"}
            </span>
            <div className="viewer-controls">
              <button className="btn btn-ghost btn-sm" onClick={() => canvasApiRef.current?.resetView()} title="Reset view">
                <RotateCcw size={13} /> Reset
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => canvasApiRef.current?.zoomIn()} title="Zoom in">
                <ZoomIn size={13} />
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => canvasApiRef.current?.zoomOut()} title="Zoom out">
                <ZoomOut size={13} />
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setExpanded((v) => !v)} title={expanded ? "Exit full page (Esc)" : "Expand to full page"}>
                {expanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                {expanded ? "Exit Full Page" : "Full Page"}
              </button>
            </div>
          </div>
          <AreaCanvas3D
            ref={canvasApiRef}
            area={area}
            selectedBuildingId={selectedBuildingId}
            selectedFloorId={selectedFloorId}
            hoveredFloorId={hoveredFloorId}
            onHoverFloor={setHoveredFloorId}
            onPick={handlePick}
            onHeadingChange={setHeading}
          />
        </Panel>

        <div style={{ width: 220 }}>
          {building ? (
            <Panel title="Floors">
              <div className="floor-list">
                {[...floors].sort((a, b) => b.order - a.order).map((f) => (
                  <button
                    key={f.id}
                    className={`floor-item${selectedFloorId === f.id ? " active" : ""}`}
                    onMouseEnter={() => setHoveredFloorId(f.id)}
                    onMouseLeave={() => setHoveredFloorId((h) => (h === f.id ? null : h))}
                    onClick={() => { setSelectedFloorId(f.id); setActiveUnitId(null); }}
                  >
                    <span className="floor-swatch" style={{ background: `#${f.colorHex.toString(16).padStart(6, "0")}` }} />
                    <span className="floor-item-name">{f.name}</span>
                    {generatedUlpins[f.id] && <CheckCircle2 size={13} color="var(--success)" />}
                  </button>
                ))}
              </div>
            </Panel>
          ) : (
            <Panel title="Buildings in this Area">
              <div className="floor-list">
                {area.parcels.map((p) => (
                  <button key={p.id} className="floor-item" onClick={() => handlePick(p.building.id, null)}>
                    <Building2 size={13} />
                    <span className="floor-item-name">{p.building.id}</span>
                  </button>
                ))}
              </div>
            </Panel>
          )}

          <Panel title="Site Reference" style={{ marginTop: 14 }}>
            <FieldList
              items={[
                { label: "Latitude / Longitude", value: area.coordinates, mono: true },
                { label: "Altitude", value: `${area.altitudeM} m (MSL, approx.)` },
                { label: "Heading", value: `${heading}°`, mono: true },
                { label: "Datum", value: "WGS84" },
              ]}
            />
          </Panel>
        </div>

        <Panel title={selectedFloor ? selectedFloor.name : building ? building.id : "Selected Building"} style={{ width: 320 }}>
          {!building && (
            <div className="empty-state small">
              <p>Click any building in the 3D area (or the list on the left) to focus on it.</p>
            </div>
          )}

          {building && !selectedFloor && (
            <>
              <FieldList
                items={[
                  { label: "Building ID", value: building.id, mono: true },
                  { label: "Type", value: building.type },
                  { label: "Floors", value: building.floors.length },
                  { label: "Height", value: `${building.heightM} m` },
                  { label: "Parcel", value: parcel.parcelId, mono: true },
                ]}
              />
              <StatusPill status="Mapped" />
              <p className="muted-text" style={{ marginTop: 10 }}>Click a floor — in the 3D view or the list — to inspect it.</p>
            </>
          )}

          {selectedFloor && (
            <>
              <FieldList
                items={[
                  { label: "Floor ID", value: selectedFloor.id, mono: true },
                  { label: "Property Type", value: selectedFloor.propertyType },
                  { label: "Usage", value: selectedFloor.usage },
                  { label: "Area", value: `${selectedFloor.areaSqm} m²` },
                  { label: "Elevation", value: selectedFloor.elevationLabel },
                  { label: "Floor Height", value: `${selectedFloor.heightM} m` },
                  { label: "Parent Building", value: building.id, mono: true },
                  { label: "Parcel", value: parcel.parcelId, mono: true },
                  { label: "Existing 2D ULPIN", value: parcel.ulpin2D, mono: true },
                ]}
              />
              <StatusPill status={selectedFloor.mappingStatus} />

              {selectedFloor.units && selectedFloor.units.length > 0 ? (
                <>
                  <div className="unit-chips">
                    {selectedFloor.units.map((u) => (
                      <button
                        key={u.id}
                        className={`chip${activeUnitId === u.id ? " chip-active" : ""}`}
                        onClick={() => setActiveUnitId(u.id)}
                      >
                        {u.label}
                      </button>
                    ))}
                  </div>

                  <FloorPlanSVG floor={selectedFloor} />

                  <div className="ulpin-box">
                    {generated ? (
                      <>
                        <div className="ulpin-box-label">3D ULPIN Generated</div>
                        <div className="ulpin-code">{generated.code}</div>
                      </>
                    ) : ulpinAnim ? (
                      <div className="ulpin-checklist">
                        <div className={ulpinAnim.step >= 1 ? "check done" : "check"}>{ulpinAnim.step >= 1 ? <CheckCircle2 size={14} /> : <Loader2 size={14} className="spin" />} Vertical Unit Identified</div>
                        <div className={ulpinAnim.step >= 2 ? "check done" : "check"}>{ulpinAnim.step >= 2 ? <CheckCircle2 size={14} /> : <Circle size={14} />} Spatial Mapping Complete</div>
                        <div className={ulpinAnim.step >= 3 ? "check done" : "check"}>{ulpinAnim.step >= 3 ? <CheckCircle2 size={14} /> : <Circle size={14} />} 3D Property Record Created</div>
                      </div>
                    ) : (
                      <>
                        <div className="ulpin-box-label">3D ULPIN (preview)</div>
                        <div className="ulpin-code muted">{ulpin3D}</div>
                        <Button variant="primary" size="sm" onClick={handleGenerate} disabled={!activeUnit}>
                          Generate 3D ULPIN
                        </Button>
                      </>
                    )}
                  </div>
                </>
              ) : (
                <p className="muted-text" style={{ marginTop: 10 }}>
                  No unit-level records are available for this floor yet.
                </p>
              )}
            </>
          )}
        </Panel>
      </div>
    </div>
  );
}

/* ---------------------------- REPORTS ---------------------------- */

function Reports({ area, generatedUlpins, goTo }) {
  if (!area || !area.processed) {
    return (
      <div className="page">
        <div className="page-intro"><h1>Reports</h1></div>
        <Panel>
          <div className="empty-state">
            <Info size={22} />
            <p>No mapped area is available yet. Select an area and run processing first.</p>
            <Button variant="primary" icon={Cpu} onClick={() => goTo("processing")}>Go to Processing</Button>
          </div>
        </Panel>
      </div>
    );
  }

  const allFloorsAcrossBuildings = area.parcels.flatMap((p) =>
    [...p.building.floors].sort((a, b) => a.order - b.order).map((f) => ({ ...f, buildingId: p.building.id }))
  );

  return (
    <div className="page">
      <div className="page-intro">
        <h1>Area Report</h1>
        <p>Combined summary of every building in this area and its 3D ULPIN status.</p>
      </div>

      <div className="grid-2">
        <Panel title="Area">
          <FieldList
            items={[
              { label: "Area Code", value: area.code, mono: true },
              { label: "Name", value: area.name },
              { label: "Location", value: `${area.district}, ${area.state}` },
              { label: "Coordinates", value: area.coordinates, mono: true },
              { label: "Total Buildings", value: area.parcels.length },
              { label: "Total Parcel Area", value: `${area.parcels.reduce((s, p) => s + p.areaSqm, 0)} m²` },
            ]}
          />
        </Panel>
        <Panel title="Buildings">
          <table className="table">
            <thead><tr><th>ID</th><th>Type</th><th>Floors</th><th>Height</th></tr></thead>
            <tbody>
              {area.parcels.map((p) => (
                <tr key={p.id}>
                  <td className="mono-strong-sm">{p.building.id}</td>
                  <td>{p.building.type}</td>
                  <td>{p.building.floors.length}</td>
                  <td>{p.building.heightM} m</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      <Panel title="Floor-wise 3D ULPIN Status — All Buildings" style={{ marginTop: 20 }}>
        <table className="table">
          <thead>
            <tr><th>Building</th><th>Floor</th><th>Usage</th><th>Area</th><th>Elevation</th><th>Status</th><th>3D ULPIN</th></tr>
          </thead>
          <tbody>
            {allFloorsAcrossBuildings.map((f) => {
              const g = generatedUlpins[f.id];
              return (
                <tr key={f.id}>
                  <td className="mono-strong-sm">{f.buildingId}</td>
                  <td>{f.name}</td>
                  <td>{f.usage}</td>
                  <td>{f.areaSqm} m²</td>
                  <td>{f.elevationLabel}</td>
                  <td><StatusPill status={f.mappingStatus} /></td>
                  <td style={{ fontFamily: "var(--font-mono)" }}>{g ? g.code : <span className="muted-text">Not yet generated</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="muted-text" style={{ marginTop: 12 }}>
          Prototype identifier scheme (2D ULPIN + Building + Floor + Unit code) — not an official
          ULPIN specification.
        </p>
        <div className="btn-row">
          <Button variant="secondary" icon={BoxIcon} onClick={() => goTo("viewer3d")}>Open 3D Area Viewer</Button>
          <Button variant="ghost" onClick={() => window.print()}>Print Report</Button>
        </div>
      </Panel>
    </div>
  );
}

/* ---------------------------- APP ROOT ---------------------------- */

function initialSourceStatus() {
  return Object.fromEntries(DATA_SOURCES.map((s) => [s.id, "idle"]));
}

export default function App() {
  const [view, setView] = useState("dashboard");
  const [areas, setAreas] = useState(AREAS);
  const [selectedAreaId, setSelectedAreaId] = useState(AREAS[0].id);
  const [selectedBuildingByArea, setSelectedBuildingByArea] = useState({});
  const [selectedBuildingId, setSelectedBuildingId] = useState(null);
  const [selectedFloorId, setSelectedFloorId] = useState(null);
  const [sourceStatus, setSourceStatus] = useState(initialSourceStatus);
  const [processing, setProcessing] = useState({ status: "idle", stepIndex: -1 });
  const [generatedUlpins, setGeneratedUlpins] = useState({});
  const [toasts, setToasts] = useState([]);

  const selectedArea = areas.find((a) => a.id === selectedAreaId) || null;
  const allSourcesLoaded = DATA_SOURCES.every((s) => sourceStatus[s.id] === "loaded");
  const ulpinCount = Object.keys(generatedUlpins).length;

  const goTo = useCallback((v) => setView(v), []);

  const pushToast = useCallback((message) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  function handleSetSelectedArea(id) {
    setSelectedAreaId(id);
    setSelectedBuildingId(selectedBuildingByArea[id] || null);
    setSelectedFloorId(null);
  }

  function preselectBuilding(areaId, buildingParcelId) {
    const a = areas.find((ar) => ar.id === areaId);
    const parcel = a?.parcels.find((p) => p.id === buildingParcelId);
    if (!parcel) return;
    setSelectedBuildingByArea((m) => ({ ...m, [areaId]: parcel.building.id }));
    if (areaId === selectedAreaId) setSelectedBuildingId(parcel.building.id);
  }

  function loadSource(id) {
    setSourceStatus((s) => ({ ...s, [id]: "loading" }));
    setTimeout(() => setSourceStatus((s) => ({ ...s, [id]: "loaded" })), 550 + Math.random() * 400);
  }
  function loadAll() {
    DATA_SOURCES.forEach((s, i) => {
      setSourceStatus((cur) => ({ ...cur, [s.id]: "loading" }));
      setTimeout(() => setSourceStatus((cur) => ({ ...cur, [s.id]: "loaded" })), 400 + i * 220);
    });
    setTimeout(() => pushToast("All data sources loaded"), 400 + DATA_SOURCES.length * 220 + 200);
  }

  function startProcessing() {
    if (!selectedArea || !allSourcesLoaded) return;
    setProcessing({ status: "running", stepIndex: 0 });
    PROCESSING_STEPS.forEach((_, i) => {
      setTimeout(() => setProcessing((p) => ({ status: "running", stepIndex: i })), i * 700);
    });
    setTimeout(() => {
      setProcessing({ status: "done", stepIndex: PROCESSING_STEPS.length });
      setAreas((as) => as.map((a) => (a.id === selectedArea.id ? { ...a, processed: true } : a)));
      pushToast("3D area model ready");
    }, PROCESSING_STEPS.length * 700 + 300);
  }

  function generateUlpin(floorId, unitId, code) {
    setGeneratedUlpins((g) => ({ ...g, [floorId]: { unitId, code } }));
    pushToast(`3D ULPIN generated · ${code}`);
  }

  function resetAll() {
    setAreas(AREAS);
    setSelectedAreaId(AREAS[0].id);
    setSelectedBuildingByArea({});
    setSelectedBuildingId(null);
    setSelectedFloorId(null);
    setSourceStatus(initialSourceStatus());
    setProcessing({ status: "idle", stepIndex: -1 });
    setGeneratedUlpins({});
    setView("dashboard");
  }

  return (
    <div className="app-shell">
      <style>{CSS}</style>
      <NavRail view={view} setView={setView} />
      <div className="main-col">
        <TopBar view={view} selectedArea={selectedArea} onReset={resetAll} />
        <div className="page-area" key={view}>
          {view === "dashboard" && (
            <Dashboard
              areas={areas}
              selectedArea={selectedArea}
              processing={processing}
              allSourcesLoaded={allSourcesLoaded}
              ulpinCount={ulpinCount}
              goTo={goTo}
            />
          )}
          {view === "records" && (
            <Records areas={areas} selectedAreaId={selectedAreaId} setSelectedAreaId={handleSetSelectedArea} goTo={goTo} />
          )}
          {view === "map2d" && (
            <Map2D
              areas={areas}
              selectedAreaId={selectedAreaId}
              setSelectedAreaId={handleSetSelectedArea}
              selectedBuildingByArea={selectedBuildingByArea}
              setPreselectBuilding={preselectBuilding}
              goTo={goTo}
            />
          )}
          {view === "sources" && (
            <DataSources sourceStatus={sourceStatus} loadSource={loadSource} loadAll={loadAll} allLoaded={allSourcesLoaded} />
          )}
          {view === "processing" && (
            <Processing
              selectedArea={selectedArea}
              allSourcesLoaded={allSourcesLoaded}
              processing={processing}
              startProcessing={startProcessing}
              goTo={goTo}
            />
          )}
          {view === "viewer3d" && (
            <Viewer3D
              area={selectedArea}
              selectedBuildingId={selectedBuildingId}
              setSelectedBuildingId={setSelectedBuildingId}
              selectedFloorId={selectedFloorId}
              setSelectedFloorId={setSelectedFloorId}
              generatedUlpins={generatedUlpins}
              generateUlpin={generateUlpin}
              goTo={goTo}
            />
          )}
          {view === "reports" && (
            <Reports area={selectedArea} generatedUlpins={generatedUlpins} goTo={goTo} />
          )}
        </div>
      </div>
      <ToastStack toasts={toasts} />
    </div>
  );
}

/* ---------------------------- STYLES ---------------------------- */

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');

:root {
  --font-sans: 'IBM Plex Sans', -apple-system, sans-serif;
  --font-mono: 'IBM Plex Mono', 'SF Mono', monospace;
  --bg: #F5F6F2;
  --panel: #FFFFFF;
  --ink: #1E2723;
  --ink-soft: #4B564F;
  --muted: #7C877E;
  --border: #DBE0D6;
  --line: #E8EBE3;
  --primary: #0F5C4F;
  --primary-dark: #0A4A3F;
  --primary-soft: #E4F0EC;
  --amber: #A9711F;
  --amber-soft: #FBF0DD;
  --success: #2E7D53;
  --success-soft: #E6F3EA;
}
* { box-sizing: border-box; }
.app-shell { display: flex; width: 100%; min-height: 100vh; background: var(--bg); color: var(--ink); font-family: var(--font-sans); font-size: 14px; }
.app-shell a { color: var(--primary); cursor: pointer; text-decoration: underline; }

.navrail { width: 216px; flex-shrink: 0; background: var(--panel); border-right: 1px solid var(--border); display: flex; flex-direction: column; padding: 18px 12px; }
.brand { display: flex; align-items: center; gap: 10px; padding: 4px 6px 18px 6px; border-bottom: 1px solid var(--line); margin-bottom: 12px; }
.brand-mark { width: 34px; height: 34px; border-radius: 6px; background: var(--primary); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 11px; letter-spacing: 0.02em; font-family: var(--font-mono); }
.brand-name { font-weight: 600; font-size: 14.5px; line-height: 1.2; }
.brand-sub { font-size: 11px; color: var(--muted); margin-top: 1px; }
.navlist { display: flex; flex-direction: column; gap: 2px; flex: 1; }
.navitem { display: flex; align-items: center; gap: 10px; padding: 9px 10px; border-radius: 6px; border: none; background: transparent; color: var(--ink-soft); font-size: 13.5px; font-weight: 500; cursor: pointer; text-align: left; font-family: var(--font-sans); transition: background 0.15s ease, color 0.15s ease, transform 0.15s ease; }
.navitem:hover { background: var(--line); color: var(--ink); transform: translateX(2px); }
.navitem.active { background: var(--primary-soft); color: var(--primary-dark); }
.navitem svg { transition: transform 0.15s ease; }
.navitem:hover svg { transform: scale(1.08); }
.navfoot { display: flex; align-items: center; gap: 7px; padding: 10px 8px 2px; font-size: 11px; color: var(--muted); border-top: 1px solid var(--line); margin-top: 8px; }

.main-col { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.topbar { height: 52px; flex-shrink: 0; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; padding: 0 22px; background: var(--panel); }
.crumb { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--muted); }
.crumb-current { color: var(--ink); font-weight: 600; transition: color 0.2s ease; }
.topbar-right { display: flex; align-items: center; gap: 10px; }

.page-area { flex: 1; overflow: auto; padding: 24px 28px 40px; }
.page { max-width: 1180px; animation: v3d-page-in 0.28s ease; }
.page-expanded {
  position: fixed;
  inset: 0;
  z-index: 200;
  max-width: none;
  background: var(--bg);
  padding: 16px 20px;
  margin: 0;
  overflow: auto;
}
.page-expanded .canvas3d { height: calc(100vh - 96px); }
@keyframes v3d-page-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
.page-intro { margin-bottom: 20px; }
.page-intro h1 { font-size: 21px; font-weight: 600; margin: 0 0 4px; letter-spacing: -0.01em; }
.page-intro p { margin: 0; color: var(--ink-soft); font-size: 13.5px; max-width: 640px; }

.tag { display: inline-flex; align-items: center; padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; letter-spacing: 0.01em; }
.status-pill { display: inline-flex; align-items: center; gap: 6px; padding: 4px 9px; border-radius: 5px; font-size: 12px; font-weight: 600; }
.status-dot { width: 6px; height: 6px; border-radius: 50%; }

.panel { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 16px 18px; transition: box-shadow 0.18s ease, border-color 0.18s ease; }
.panel-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.panel-head h3 { margin: 0; font-size: 13px; font-weight: 600; color: var(--ink-soft); text-transform: uppercase; letter-spacing: 0.04em; }

.grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
.grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
@media (max-width: 1080px) { .grid-4 { grid-template-columns: repeat(2,1fr); } .grid-3 { grid-template-columns: repeat(2,1fr); } .grid-2 { grid-template-columns: 1fr; } }

.stat-big { font-size: 26px; font-weight: 700; letter-spacing: -0.01em; transition: color 0.2s ease; }
.stat-caption { font-size: 12px; color: var(--muted); margin-top: 4px; }
.grid-4 .panel:hover .stat-big { color: var(--primary-dark); }

.flow-list { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 8px; font-size: 13px; color: var(--ink-soft); }
.flow-list b { color: var(--ink); }

.concept-chain { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.concept-node { background: var(--primary-soft); color: var(--primary-dark); padding: 5px 10px; border-radius: 5px; font-size: 12px; font-weight: 600; transition: transform 0.15s ease, background 0.15s ease; cursor: default; }
.concept-node:hover { transform: translateY(-2px); background: var(--primary); color: #fff; }
.concept-arrow { color: var(--muted); }
.muted-text { color: var(--muted); font-size: 12.5px; line-height: 1.5; }

.btn { display: inline-flex; align-items: center; gap: 6px; border-radius: 6px; font-weight: 600; cursor: pointer; font-family: var(--font-sans); border: 1px solid transparent; white-space: nowrap; transition: background 0.15s ease, border-color 0.15s ease, transform 0.08s ease, box-shadow 0.15s ease; }
.btn:disabled { opacity: 0.45; cursor: not-allowed; }
.btn:not(:disabled):active { transform: scale(0.96); }
.btn-md { padding: 9px 14px; font-size: 13px; }
.btn-sm { padding: 6px 10px; font-size: 12px; }
.btn-primary { background: var(--primary); color: #fff; }
.btn-primary:not(:disabled):hover { background: var(--primary-dark); box-shadow: 0 2px 10px rgba(15,92,79,0.28); }
.btn-secondary { background: var(--panel); color: var(--ink); border-color: var(--border); }
.btn-secondary:not(:disabled):hover { background: var(--line); }
.btn-ghost { background: transparent; color: var(--ink-soft); border-color: var(--border); }
.btn-ghost:hover { background: var(--line); }
.btn-row { display: flex; gap: 10px; margin-top: 14px; flex-wrap: wrap; }

.field-list { display: flex; flex-direction: column; gap: 0; }
.field-row { display: flex; justify-content: space-between; gap: 12px; padding: 7px 0; border-bottom: 1px solid var(--line); font-size: 13px; }
.field-row:last-child { border-bottom: none; }
.field-label { color: var(--muted); }
.field-value { font-weight: 600; text-align: right; }

.split-layout { display: flex; gap: 14px; align-items: flex-start; flex-wrap: wrap; }

.record-list { display: flex; flex-direction: column; gap: 10px; width: 260px; flex-shrink: 0; }
.record-card { text-align: left; background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; cursor: pointer; font-family: var(--font-sans); transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.1s ease; }
.record-card:hover { border-color: var(--primary); transform: translateY(-1px); box-shadow: 0 3px 10px rgba(15,92,79,0.1); }
.record-card:active { transform: translateY(0); }
.record-card.active { border-color: var(--primary); box-shadow: 0 0 0 1px var(--primary); }
.record-card-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
.mono-strong { font-family: var(--font-mono); font-weight: 600; font-size: 13px; }
.mono-strong-sm { font-family: var(--font-mono); font-weight: 500; font-size: 11.5px; color: var(--ink-soft); }
.record-card-loc { display: flex; align-items: center; gap: 5px; font-size: 12px; color: var(--ink-soft); margin-bottom: 8px; }
.record-card-foot { display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: var(--muted); }

.records-building-list { display: flex; flex-direction: column; gap: 6px; margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--line); }
.records-building-row { display: flex; align-items: center; gap: 10px; font-size: 12.5px; color: var(--ink-soft); }
.records-building-row span:nth-child(2) { flex: 1; }

.map-toolbar { display: flex; gap: 8px; margin-bottom: 10px; }
.chip { padding: 5px 11px; border-radius: 999px; border: 1px solid var(--border); background: var(--panel); font-size: 12px; font-family: var(--font-mono); cursor: pointer; color: var(--ink-soft); transition: background 0.15s ease, border-color 0.15s ease, transform 0.1s ease; }
.chip:hover { border-color: var(--primary); transform: translateY(-1px); }
.chip-active { background: var(--primary-soft); border-color: var(--primary); color: var(--primary-dark); }
.map-canvas { position: relative; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; background: #FBFCFA; }
.map-canvas-el { width: 100%; height: 340px; display: block; }
.map-footprint { cursor: pointer; }
.map-label { font-size: 9px; font-family: var(--font-mono); fill: var(--ink); }
.map-label-sub { font-size: 8px; font-family: var(--font-mono); fill: var(--muted); }
.map-tiny { font-size: 8px; fill: var(--ink-soft); }
.map-legend { position: absolute; bottom: 10px; left: 10px; background: rgba(255,255,255,0.9); border: 1px solid var(--border); border-radius: 5px; padding: 6px 10px; display: flex; flex-direction: column; gap: 3px; font-size: 11px; color: var(--ink-soft); }
.legend-swatch { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 6px; }

.source-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.source-icon { width: 32px; height: 32px; border-radius: 6px; background: var(--primary-soft); color: var(--primary-dark); display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: transform 0.2s ease, background 0.2s ease; }
.panel:hover .source-icon { transform: scale(1.06); }
.source-name { font-weight: 600; font-size: 13.5px; margin-bottom: 3px; }
.source-meta { display: flex; justify-content: space-between; font-size: 11px; color: var(--muted); margin: 10px 0; padding-top: 8px; border-top: 1px solid var(--line); }
.source-foot { margin-top: 4px; }

.pipeline { display: flex; flex-direction: column; }
.pipeline-step { display: flex; gap: 12px; padding: 10px 0; border-left: 2px solid var(--line); margin-left: 8px; padding-left: 16px; position: relative; }
.pipeline-step:last-child { border-left-color: transparent; }
.pipeline-marker { position: absolute; left: -9px; top: 10px; background: var(--panel); color: var(--muted); }
.pipeline-step.state-done .pipeline-marker { color: var(--success); }
.pipeline-step.state-active .pipeline-marker { color: var(--primary); }
.pipeline-label { font-weight: 600; font-size: 13.5px; }
.pipeline-step.state-pending .pipeline-label { color: var(--muted); }
.pipeline-detail { font-size: 12px; color: var(--muted); margin-top: 2px; }

.canvas3d { width: 100%; height: 460px; display: block; }
.canvas3d-wrap { position: relative; }
.compass-hud {
  position: absolute; top: 14px; right: 14px; width: 52px; height: 52px; border-radius: 50%;
  background: rgba(255,255,255,0.88); border: 1px solid var(--border); box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  display: flex; align-items: center; justify-content: center; z-index: 5;
}
.compass-face { position: relative; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; will-change: transform; }
.compass-arrow { position: absolute; top: 6px; left: 50%; width: 0; height: 0; transform: translateX(-50%); border-left: 5px solid transparent; border-right: 5px solid transparent; border-bottom: 14px solid var(--primary); }
.compass-n { position: absolute; top: 20px; font-size: 10px; font-weight: 700; color: var(--ink-soft); }
.viewer-caption { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--line); font-size: 12.5px; color: var(--ink-soft); font-weight: 500; flex-wrap: wrap; }
.viewer-controls { display: flex; gap: 6px; }
.viewer-caption-geo { color: var(--ink-soft); padding-left: 8px; border-left: 1px solid var(--line); }
.viewer-hover-text { margin-left: auto; color: var(--muted); font-weight: 400; }

.floor-list { display: flex; flex-direction: column; gap: 4px; }
.floor-item { display: flex; align-items: center; gap: 8px; padding: 7px 8px; border-radius: 5px; border: none; background: transparent; cursor: pointer; font-size: 12.5px; text-align: left; font-family: var(--font-sans); color: var(--ink-soft); transition: background 0.12s ease, color 0.12s ease, padding-left 0.15s ease; width: 100%; }
.floor-item:hover { background: var(--line); padding-left: 11px; }
.floor-item.active { background: var(--primary-soft); color: var(--primary-dark); font-weight: 600; }
.floor-swatch { width: 10px; height: 10px; border-radius: 2px; flex-shrink: 0; }
.floor-item-name { flex: 1; }

.unit-chips { display: flex; gap: 6px; flex-wrap: wrap; margin: 12px 0 10px; }
.floorplan-svg { width: 100%; height: auto; margin: 6px 0 14px; }
.fp-label { font-size: 10px; fill: var(--primary-dark); font-weight: 600; }
.fp-sub { font-size: 9px; fill: var(--ink-soft); }

.ulpin-box { background: var(--bg); border: 1px dashed var(--border); border-radius: 6px; padding: 12px 14px; margin-top: 4px; }
.ulpin-box-label { font-size: 11px; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; margin-bottom: 6px; }
.ulpin-code { font-family: var(--font-mono); font-size: 15px; font-weight: 600; color: var(--primary-dark); margin-bottom: 10px; }
.ulpin-code.muted { color: var(--muted); font-weight: 500; }
.ulpin-checklist { display: flex; flex-direction: column; gap: 7px; }
.check { display: flex; align-items: center; gap: 7px; font-size: 12.5px; color: var(--muted); }
.check.done { color: var(--success); font-weight: 500; }

.table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.table th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em; color: var(--muted); padding: 8px 10px; border-bottom: 1px solid var(--border); }
.table td { padding: 9px 10px; border-bottom: 1px solid var(--line); }

.empty-state { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; color: var(--ink-soft); padding: 10px 0; }
.empty-state.small { padding: 20px 0; align-items: center; text-align: center; }
.empty-state p { margin: 0; font-size: 13px; max-width: 380px; }

.spin { animation: v3d-spin 0.9s linear infinite; }
@keyframes v3d-spin { to { transform: rotate(360deg); } }

.toast-stack { position: fixed; bottom: 22px; right: 22px; display: flex; flex-direction: column; gap: 8px; z-index: 50; }
.toast { display: flex; align-items: center; gap: 8px; background: var(--ink); color: #fff; padding: 10px 16px; border-radius: 7px; font-size: 13px; font-weight: 500; box-shadow: 0 6px 20px rgba(0,0,0,0.18); animation: v3d-toast-in 0.22s ease; }
.toast svg { color: #6fe0bd; flex-shrink: 0; }
@keyframes v3d-toast-in { from { opacity: 0; transform: translateY(8px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }

@media (max-width: 900px) {
  .navrail { width: 64px; }
  .brand-text, .navitem span, .navfoot span { display: none; }
  .navitem { justify-content: center; }
}
`;
