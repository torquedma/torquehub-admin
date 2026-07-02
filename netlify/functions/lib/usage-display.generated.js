// GENERATED FROM usage-display.source.json — DO NOT EDIT. Run node scripts/generate-usage-display.js
'use strict';

const { canonicalize } = require('./taxonomy.generated.js');

const ALLOW_HOURS = new Set([
  'Tractor',
  'Lawn Tractor',
  'Zero Turn Mower',
  'Walk Behind Mower',
  'Front Mounted Mower',
  'Field Mower',
  'Finish Mower',
  'Rotary Cutter',
  'Boom Mower',
  'Drum Mower',
  'Hay Rake',
  'Baler',
  'Cultivator',
  'Planter',
  'Combine',
  'Log Splitter',
  'Wagon',
  'Harrow',
  'Disk',
  'Box Scraper',
  'Utility Vehicle',
  'Land Leveler',
  'Overseeder',
  'V-Ripper',
  'Turf & Grounds Care',
  'Skid Steer',
  'Mini Skid Steer',
  'Compact Track Loader',
  'Loader',
  'Wheel Loader',
  'Boom Lift',
  'Backhoe',
  'Excavator',
  'Mini Excavator',
  'Crawler Dozer',
  'Forklift',
  'Digger Derrick',
  'Trencher',
  'Scissor Lift',
  'Compactor',
  'Scraper',
  'Air Compressor',
  'Motor Grader',
  'Backhoe Attachment',
  'Crawler Loader'
]);

const ALLOW_MILEAGE = new Set([
  'Box Truck',
  'Day Cab Tractor',
  'Sleeper Tractor',
  'Service Truck',
  'Dump Truck',
  'Rollback Tow Truck',
  'Tow Truck',
  'Flatbed Truck',
  'Car Carrier Truck',
  'Cargo Van',
  'Passenger Van',
  'Pickup Truck',
  'Crane Truck',
  'Refrigerated Truck',
  'Tanker Truck',
  'Vacuum Truck',
  'Fuel Truck',
  'Step Van',
  'Garbage Truck',
  'Concrete Mixer',
  'Grain Dump Truck',
  'Bucket Truck',
  'Roll-Off',
  'Boom Truck',
  'Mixer Truck',
  'Yard Spotter',
  'Cab & Chassis',
  'Fire Truck',
  'Winch Truck',
  'Crane Service Truck',
  'Landscape Truck',
  'Water Truck',
  'SUV',
  'Motorcycle',
  'Classic Car',
  'Side by Side'
]);

const SUPPRESS_BOTH = new Set([
  'Enclosed Trailer',
  'Car Hauler Trailer',
  'Utility Trailer',
  'Dump Trailer',
  'Equipment Trailer',
  'Gooseneck Trailer',
  'Conestoga Trailer',
  'Concession Trailer',
  'Race Trailer',
  'Living Quarters Trailer',
  'Deckover Trailer',
  'Tilt Trailer',
  'Dovetail Trailer',
  'Tank Trailer',
  'Tanker Trailer',
  'Dry Van Trailer',
  'Motorcycle Trailer',
  'Landscape Trailer',
  'Frameless Dump',
  'Other Trailer',
  'Reefer Trailer',
  'Pole Trailer',
  'Reel / Cable Trailer',
  'Curtain-Side Trailer',
  'Lowboy Trailer',
  'Flatbed Trailer',
  'Hopper Bottom Trailer',
  'Belt Trailer',
  'Boat',
  'Engine',
  'Truck Body'
]);

// Normalize unit.subcategory through the taxonomy alias map to a canonical value.
// Reuses canonicalize() from taxonomy.generated.js — do NOT re-implement.
// Returns '' when raw is missing, unmapped, or aliased-to-empty ('Mower','Lawn & Garden').
function normalizeSubcategory(unit) {
  const raw = String((unit && unit.subcategory) || '').trim();
  if (!raw) return '';
  const canonical = canonicalize(raw);
  return canonical || '';
}

// Numeric guard shared by both rules: rejects null/undefined/empty/'0'/'0 miles' etc.
function hasRealNumber(v) {
  if (v == null) return false;
  const s = String(v).trim();
  if (s === '') return false;
  const numPart = s.replace(/[^0-9.]/g, '');
  return numPart !== '' && Number(numPart) !== 0;
}

function showMileage(unit) {
  const sub = normalizeSubcategory(unit);
  if (!sub) {
    console.warn('[usage-display] unmapped subcategory: ' + ((unit && unit.subcategory) || '(none)'));
    return false;
  }
  if (!ALLOW_MILEAGE.has(sub)) return false;
  return hasRealNumber(unit.mileage);
}

function showHours(unit) {
  const sub = normalizeSubcategory(unit);
  if (!sub) {
    console.warn('[usage-display] unmapped subcategory: ' + ((unit && unit.subcategory) || '(none)'));
    return false;
  }
  if (!ALLOW_HOURS.has(sub)) return false;
  return hasRealNumber(unit.hours);
}

module.exports = { showMileage, showHours, normalizeSubcategory };
