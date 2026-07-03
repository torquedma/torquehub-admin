// GENERATED FROM intake-fieldsets.source.json — DO NOT EDIT. Run node scripts/generate-intake-fieldsets.js
'use strict';

// Dispatch imports usageClass from the already-generated usage-display CJS
// mirror. Do NOT hand-maintain a second construction-equipment list; usageClass
// composes the answer from ALLOW_HOURS / ALLOW_MILEAGE / SUPPRESS_BOTH.
const { usageClass } = require('./usage-display.generated.js');

const DATA = {
  "_doctrine": "v2 fieldsets are not the Universal Inventory Schema. They are a thin, practical subset shaped to become it.",
  "shared_human_review": [
    "Price",
    "Condition",
    "Title / paperwork",
    "Service history"
  ],
  "fieldsets": {
    "truck": {
      "preamble": "You are identifying a commercial truck (road-legal, odometer-based) for a commercial equipment marketplace.",
      "fields": [
        {
          "key": "make",
          "label": "Make",
          "question": "What make is the truck?",
          "type": "string",
          "requiredness": "required",
          "ai_proposable": true,
          "prompt_rule": "Read the visible make from decals, badges, or the grille. Do not infer make from body style or paint.",
          "storable": true,
          "consumers": [
            "prompt",
            "review_ui",
            "save_draft"
          ]
        },
        {
          "key": "model",
          "label": "Model",
          "question": "What model is the truck?",
          "type": "string",
          "requiredness": "required",
          "ai_proposable": true,
          "prompt_rule": "Read the visible model from badges, decals, or a legible model plate. Do not infer model from styling generation.",
          "storable": true,
          "consumers": [
            "prompt",
            "review_ui",
            "save_draft"
          ]
        },
        {
          "key": "year",
          "label": "Year",
          "question": "What model year is the truck?",
          "type": "number",
          "requiredness": "recommended",
          "ai_proposable": true,
          "prompt_rule": "Only propose year from a VIN decode (when a VIN is present and the year digit is unambiguous), a data plate, a window sticker, or a title photo. Do not infer year from body generation or appearance.",
          "confirm_required": true,
          "storable": true,
          "consumers": [
            "prompt",
            "review_ui",
            "save_draft"
          ]
        },
        {
          "key": "mileage",
          "label": "Mileage",
          "question": "What is the odometer reading?",
          "type": "number",
          "unit": "mi",
          "requiredness": "recommended",
          "ai_proposable": true,
          "prompt_rule": "Only propose mileage from a legibly visible odometer or dash display. Never estimate mileage from age or condition.",
          "confirm_required": true,
          "storable": true,
          "consumers": [
            "prompt",
            "review_ui",
            "save_draft"
          ]
        },
        {
          "key": "engine",
          "label": "Engine",
          "question": "What engine is installed?",
          "type": "string",
          "requiredness": "optional",
          "ai_proposable": true,
          "prompt_rule": "Read engine identification from a visible valve-cover label, an under-hood plate, or a data placard. Do not infer engine from truck model number.",
          "storable": true,
          "consumers": [
            "prompt",
            "review_ui",
            "save_draft"
          ]
        },
        {
          "key": "transmission",
          "label": "Transmission",
          "question": "What transmission is installed?",
          "type": "enum",
          "constraint": [
            "Automatic",
            "Manual",
            "Automated Manual"
          ],
          "requiredness": "optional",
          "ai_proposable": true,
          "storable": true,
          "consumers": [
            "prompt",
            "review_ui",
            "save_draft"
          ]
        },
        {
          "key": "drivetrain",
          "label": "Drivetrain",
          "question": "What is the axle configuration?",
          "type": "enum",
          "constraint": [
            "4x2",
            "4x4",
            "6x2",
            "6x4",
            "6x6",
            "8x4"
          ],
          "requiredness": "optional",
          "ai_proposable": true,
          "storable": true,
          "consumers": [
            "prompt",
            "review_ui",
            "save_draft"
          ]
        },
        {
          "key": "fuel",
          "label": "Fuel",
          "question": "What fuel type does the truck use?",
          "type": "enum",
          "constraint": [
            "Diesel",
            "Gasoline",
            "Electric",
            "CNG",
            "LPG"
          ],
          "requiredness": "optional",
          "ai_proposable": true,
          "prompt_rule": "Diesel is the category default; when proposing it as a default, the reason must state 'Diesel — category default, not visually confirmed'. A visible fuel/electric indicator OVERRIDES the default.",
          "storable": true,
          "consumers": [
            "prompt",
            "review_ui",
            "save_draft"
          ]
        },
        {
          "key": "vin",
          "label": "VIN",
          "question": "What is the VIN?",
          "type": "string",
          "requiredness": "optional",
          "ai_proposable": true,
          "prompt_rule": "Only propose a VIN if legibly readable from a door-jamb sticker, dashboard placard, or title photo. Do not guess partial characters.",
          "storable": true,
          "consumers": [
            "prompt",
            "review_ui",
            "save_draft"
          ]
        },
        {
          "key": "cab_type",
          "label": "Cab Type",
          "question": "What cab configuration does the truck have?",
          "type": "enum",
          "constraint": [
            "Day Cab",
            "Sleeper",
            "Extended Cab",
            "Crew Cab"
          ],
          "requiredness": "optional",
          "ai_proposable": true,
          "storable": false,
          "consumers": [
            "prompt",
            "review_ui"
          ]
        }
      ],
      "human_only": [
        {
          "key": "gvwr",
          "label": "GVWR",
          "question": "What is the GVWR rating?",
          "type": "string",
          "requiredness": "optional",
          "ai_proposable": false,
          "ai_review_flag": "Check the door-jamb sticker or data plate for GVWR — not reliably photo-derivable.",
          "storable": false
        },
        {
          "key": "axle_config",
          "label": "Axle Configuration",
          "question": "Confirm the axle configuration (tag/pusher axles, spread, lift axles).",
          "type": "string",
          "requiredness": "optional",
          "ai_proposable": false,
          "ai_review_flag": "Physical inspection or seller-confirmed spec — not reliably photo-derivable.",
          "storable": false
        }
      ]
    },
    "construction_equipment": {
      "preamble": "You are identifying construction equipment (hours-based) for a commercial equipment marketplace.",
      "fields": [
        {
          "key": "make",
          "label": "Make",
          "question": "What make is the machine?",
          "type": "string",
          "requiredness": "required",
          "ai_proposable": true,
          "prompt_rule": "Read the visible make from decals, badges, or a legible data plate. Do not infer make from color or shape.",
          "storable": true,
          "consumers": [
            "prompt",
            "review_ui",
            "save_draft"
          ]
        },
        {
          "key": "model",
          "label": "Model",
          "question": "What model is the machine?",
          "type": "string",
          "requiredness": "required",
          "ai_proposable": true,
          "prompt_rule": "Read the visible model from decals, badges, or a data plate. Do not infer model from styling generation.",
          "storable": true,
          "consumers": [
            "prompt",
            "review_ui",
            "save_draft"
          ]
        },
        {
          "key": "year",
          "label": "Year",
          "question": "What model year is the machine?",
          "type": "number",
          "requiredness": "recommended",
          "ai_proposable": true,
          "prompt_rule": "Only propose year from a VIN/serial decode (when a VIN or serial plate is present and the year digit is unambiguous), a data plate, or a title photo. Do not infer year from body generation or appearance.",
          "confirm_required": true,
          "storable": true,
          "consumers": [
            "prompt",
            "review_ui",
            "save_draft"
          ]
        },
        {
          "key": "hours",
          "label": "Hours",
          "question": "How many hours are shown on the machine?",
          "type": "number",
          "unit": "hrs",
          "requiredness": "recommended",
          "ai_proposable": true,
          "prompt_rule": "Only propose hours if an hour-meter, dash, monitor, or equipment display is legibly visible in a photo. Read the displayed number. Never estimate hours from age, condition, model year, or appearance.",
          "confirm_required": true,
          "storable": true,
          "consumers": [
            "prompt",
            "review_ui",
            "save_draft"
          ]
        },
        {
          "key": "engine",
          "label": "Engine",
          "question": "What engine is installed?",
          "type": "string",
          "requiredness": "optional",
          "ai_proposable": true,
          "prompt_rule": "Read engine identification from a visible valve-cover label or data plate. Do not infer engine from machine model number.",
          "storable": true,
          "consumers": [
            "prompt",
            "review_ui",
            "save_draft"
          ]
        },
        {
          "key": "fuel",
          "label": "Fuel",
          "question": "What fuel type does the machine use?",
          "type": "enum",
          "constraint": [
            "Diesel",
            "Gasoline",
            "Electric",
            "LPG"
          ],
          "requiredness": "optional",
          "ai_proposable": true,
          "prompt_rule": "Diesel is the category default; when proposing it as a default, the reason must state 'Diesel — category default, not visually confirmed'. A visible fuel/electric indicator OVERRIDES the default.",
          "storable": true,
          "consumers": [
            "prompt",
            "review_ui",
            "save_draft"
          ]
        },
        {
          "key": "cab_type",
          "label": "Cab Type",
          "question": "What cab type does the machine have?",
          "type": "enum",
          "constraint": [
            "Open ROPS",
            "Enclosed Cab"
          ],
          "requiredness": "optional",
          "ai_proposable": true,
          "storable": false,
          "consumers": [
            "prompt",
            "review_ui"
          ]
        },
        {
          "key": "attachments_included",
          "label": "Attachments Included",
          "question": "What attachments are visible in the photos?",
          "type": "array",
          "requiredness": "optional",
          "ai_proposable": true,
          "prompt_rule": "List only attachments that are visibly present in a photo. Do not list attachments based on model-typical configuration.",
          "storable": false,
          "consumers": [
            "prompt",
            "review_ui"
          ]
        }
      ],
      "human_only": [
        {
          "key": "operating_weight",
          "label": "Operating Weight",
          "question": "What is the operating weight?",
          "type": "string",
          "requiredness": "optional",
          "ai_proposable": false,
          "ai_review_flag": "Check the data plate for operating weight — not reliably photo-derivable.",
          "storable": false
        },
        {
          "key": "reach_or_capacity",
          "label": "Reach / Capacity",
          "question": "What is the reach, dig depth, or lift capacity?",
          "type": "string",
          "requiredness": "optional",
          "ai_proposable": false,
          "ai_review_flag": "Confirm reach or lift capacity from the seller or manufacturer spec sheet — not reliably photo-derivable.",
          "storable": false
        }
      ]
    },
    "farm": {
      "preamble": "You are identifying farm equipment (hours-based) for a commercial equipment marketplace.",
      "fields": [
        {
          "key": "make",
          "label": "Make",
          "question": "What make is the machine?",
          "type": "string",
          "requiredness": "required",
          "ai_proposable": true,
          "prompt_rule": "Read the visible make from decals, badges, or a legible data plate. Do not infer make from paint color.",
          "storable": true,
          "consumers": [
            "prompt",
            "review_ui",
            "save_draft"
          ]
        },
        {
          "key": "model",
          "label": "Model",
          "question": "What model is the machine?",
          "type": "string",
          "requiredness": "required",
          "ai_proposable": true,
          "prompt_rule": "Read the visible model from decals, badges, or a data plate. Do not infer model from styling.",
          "storable": true,
          "consumers": [
            "prompt",
            "review_ui",
            "save_draft"
          ]
        },
        {
          "key": "year",
          "label": "Year",
          "question": "What model year is the machine?",
          "type": "number",
          "requiredness": "recommended",
          "ai_proposable": true,
          "prompt_rule": "Only propose year from a VIN/serial decode (when a serial plate is visible and the year digit is unambiguous), a data plate, or a title photo. Do not infer year from body generation or appearance.",
          "confirm_required": true,
          "storable": true,
          "consumers": [
            "prompt",
            "review_ui",
            "save_draft"
          ]
        },
        {
          "key": "hours",
          "label": "Hours",
          "question": "How many hours are shown on the machine?",
          "type": "number",
          "unit": "hrs",
          "requiredness": "recommended",
          "ai_proposable": true,
          "prompt_rule": "Only propose hours if an hour-meter, dash, monitor, or equipment display is legibly visible in a photo. Read the displayed number. Never estimate hours from age, condition, model year, or appearance.",
          "confirm_required": true,
          "storable": true,
          "consumers": [
            "prompt",
            "review_ui",
            "save_draft"
          ]
        },
        {
          "key": "engine",
          "label": "Engine",
          "question": "What engine is installed?",
          "type": "string",
          "requiredness": "optional",
          "ai_proposable": true,
          "prompt_rule": "Read engine identification from visible badges or a data plate. Do not infer engine from machine model number.",
          "storable": true,
          "consumers": [
            "prompt",
            "review_ui",
            "save_draft"
          ]
        },
        {
          "key": "fuel",
          "label": "Fuel",
          "question": "What fuel type does the machine use?",
          "type": "enum",
          "constraint": [
            "Diesel",
            "Gasoline",
            "Electric",
            "LPG"
          ],
          "requiredness": "optional",
          "ai_proposable": true,
          "prompt_rule": "Diesel is the category default; when proposing it as a default, the reason must state 'Diesel — category default, not visually confirmed'. A visible fuel/electric indicator OVERRIDES the default.",
          "storable": true,
          "consumers": [
            "prompt",
            "review_ui",
            "save_draft"
          ]
        },
        {
          "key": "drivetrain",
          "label": "Drivetrain",
          "question": "What drivetrain does the machine have?",
          "type": "enum",
          "constraint": [
            "2WD",
            "MFWD",
            "4WD",
            "Track"
          ],
          "requiredness": "optional",
          "ai_proposable": true,
          "storable": true,
          "consumers": [
            "prompt",
            "review_ui",
            "save_draft"
          ]
        },
        {
          "key": "pto_horsepower",
          "label": "PTO Horsepower",
          "question": "What is the PTO horsepower?",
          "type": "string",
          "requiredness": "optional",
          "ai_proposable": true,
          "prompt_rule": "Only propose if a horsepower badge or data-plate value is legibly visible. Do not infer PTO HP from model number.",
          "storable": false,
          "consumers": [
            "prompt",
            "review_ui"
          ]
        }
      ],
      "human_only": [
        {
          "key": "implements_included",
          "label": "Implements Included",
          "question": "Which implements or attachments are included with the sale?",
          "type": "array",
          "requiredness": "optional",
          "ai_proposable": false,
          "ai_review_flag": "Ask the seller which implements are included with the sale — photos may show implements not part of the transaction.",
          "storable": false
        }
      ]
    },
    "trailer": {
      "preamble": "You are identifying a trailer for a commercial equipment marketplace.",
      "fields": [
        {
          "key": "make",
          "label": "Make",
          "question": "What make is the trailer?",
          "type": "string",
          "requiredness": "recommended",
          "ai_proposable": true,
          "prompt_rule": "Read the visible make from decals, a data plate, or a manufacturer badge. Do not infer make from styling.",
          "storable": true,
          "consumers": [
            "prompt",
            "review_ui",
            "save_draft"
          ]
        },
        {
          "key": "model",
          "label": "Model",
          "question": "What model is the trailer?",
          "type": "string",
          "requiredness": "optional",
          "ai_proposable": true,
          "prompt_rule": "Read the visible model from decals or a data plate. Do not infer model from body shape.",
          "storable": true,
          "consumers": [
            "prompt",
            "review_ui",
            "save_draft"
          ]
        },
        {
          "key": "year",
          "label": "Year",
          "question": "What model year is the trailer?",
          "type": "number",
          "requiredness": "recommended",
          "ai_proposable": true,
          "prompt_rule": "Only propose year from a VIN decode (when a VIN is present and the year digit is unambiguous), a data plate, or a title photo. Do not infer year from body generation or appearance.",
          "confirm_required": true,
          "storable": true,
          "consumers": [
            "prompt",
            "review_ui",
            "save_draft"
          ]
        },
        {
          "key": "vin",
          "label": "VIN",
          "question": "What is the trailer VIN?",
          "type": "string",
          "requiredness": "optional",
          "ai_proposable": true,
          "prompt_rule": "Only propose a VIN if legibly readable from a data plate, frame stamp, or title photo. Do not guess partial characters.",
          "storable": true,
          "consumers": [
            "prompt",
            "review_ui",
            "save_draft"
          ]
        },
        {
          "key": "length",
          "label": "Length",
          "question": "What is the trailer length?",
          "type": "string",
          "unit": "ft",
          "requiredness": "optional",
          "ai_proposable": true,
          "prompt_rule": "Only propose length if legibly visible on a data plate or manufacturer label. Do not estimate length from photos.",
          "storable": false,
          "consumers": [
            "prompt",
            "review_ui"
          ]
        },
        {
          "key": "axle_count",
          "label": "Axle Count",
          "question": "How many axles does the trailer have?",
          "type": "number",
          "requiredness": "optional",
          "ai_proposable": true,
          "prompt_rule": "Count visible axles from a side profile. Do not include lifted or spare axles obscured from view.",
          "storable": false,
          "consumers": [
            "prompt",
            "review_ui"
          ]
        },
        {
          "key": "deck_type",
          "label": "Deck Type",
          "question": "What deck type does the trailer have?",
          "type": "enum",
          "constraint": [
            "Flat",
            "Drop",
            "Step",
            "Dovetail",
            "Deckover",
            "Enclosed",
            "Other"
          ],
          "requiredness": "optional",
          "ai_proposable": true,
          "storable": false,
          "consumers": [
            "prompt",
            "review_ui"
          ]
        },
        {
          "key": "reefer_unit_present",
          "label": "Reefer Unit Present",
          "question": "Is a refrigeration unit installed?",
          "type": "enum",
          "constraint": [
            "Yes",
            "No"
          ],
          "requiredness": "optional",
          "ai_proposable": true,
          "prompt_rule": "Return 'Yes' only if a visible reefer unit (Thermo King, Carrier, or similar) is mounted at the nose of the trailer. Return 'No' if the trailer is a dry-van or other non-refrigerated shape. Do not propose reefer operating hours (deferred to component model).",
          "storable": false,
          "consumers": [
            "prompt",
            "review_ui"
          ]
        }
      ],
      "human_only": [
        {
          "key": "gvwr",
          "label": "GVWR",
          "question": "What is the GVWR rating?",
          "type": "string",
          "requiredness": "optional",
          "ai_proposable": false,
          "ai_review_flag": "Check the data plate for GVWR — not reliably photo-derivable.",
          "storable": false
        },
        {
          "key": "tire_condition",
          "label": "Tire Condition",
          "question": "What is the tire condition?",
          "type": "string",
          "requiredness": "optional",
          "ai_proposable": false,
          "ai_review_flag": "Physical inspection required — tread depth and sidewall condition are not reliably photo-derivable.",
          "storable": false
        }
      ]
    },
    "generic_minimal": {
      "preamble": "You are identifying a piece of commercial equipment for a commercial equipment marketplace. This subcategory does not have a specialized fieldset yet — only universal fields apply.",
      "review_warning": "This subcategory does not have a specialized fieldset. Review with extra care and consider adding a specialized fieldset entry in intake-fieldsets.source.json.",
      "fields": [
        {
          "key": "make",
          "label": "Make",
          "question": "What make is the unit?",
          "type": "string",
          "requiredness": "recommended",
          "ai_proposable": true,
          "prompt_rule": "Read the visible make from decals, badges, or a legible data plate. Do not infer from appearance.",
          "storable": true,
          "consumers": [
            "prompt",
            "review_ui",
            "save_draft"
          ]
        },
        {
          "key": "model",
          "label": "Model",
          "question": "What model is the unit?",
          "type": "string",
          "requiredness": "recommended",
          "ai_proposable": true,
          "prompt_rule": "Read the visible model from decals, badges, or a data plate. Do not infer from appearance.",
          "storable": true,
          "consumers": [
            "prompt",
            "review_ui",
            "save_draft"
          ]
        },
        {
          "key": "year",
          "label": "Year",
          "question": "What model year is the unit?",
          "type": "number",
          "requiredness": "recommended",
          "ai_proposable": true,
          "prompt_rule": "Only propose year from a VIN/serial decode (when unambiguous), a data plate, a window sticker, or a title photo. Do not infer year from body generation or appearance.",
          "confirm_required": true,
          "storable": true,
          "consumers": [
            "prompt",
            "review_ui",
            "save_draft"
          ]
        }
      ]
    }
  },
  "subcategory_overrides": {}
};

const fieldsets = DATA.fieldsets;
const shared_human_review = DATA.shared_human_review;
const subcategory_overrides = DATA.subcategory_overrides || {};

// Dispatch on (category, subcategory). Category matches are case-insensitive
// against the taxonomy's canonical category names (Trucks / Trailers / Farm /
// Construction). Construction is split by usageClass into the hours-based-
// equipment fieldset vs the road-truck fieldset (crane trucks, boom trucks).
function getFieldset(category, subcategory) {
  const cat = String(category || '').toLowerCase().trim();
  const sub = String(subcategory || '').trim();

  // Per-subcategory override — kept for rare exceptions without inventing a new fieldset.
  if (subcategory_overrides[sub] && fieldsets[subcategory_overrides[sub]]) {
    return fieldsets[subcategory_overrides[sub]];
  }

  if (cat === 'trucks')   return fieldsets.truck;
  if (cat === 'trailers') return fieldsets.trailer;
  if (cat === 'farm')     return fieldsets.farm;
  if (cat === 'construction') {
    const cls = usageClass({ subcategory: sub });
    if (cls === 'hours-based') return fieldsets.construction_equipment;
    if (cls === 'odometer')    return fieldsets.truck;
    return fieldsets.generic_minimal;
  }
  return fieldsets.generic_minimal;
}

module.exports = { getFieldset, fieldsets, shared_human_review };
