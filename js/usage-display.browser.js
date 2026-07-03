// GENERATED FROM usage-display.source.json — DO NOT EDIT. Run node scripts/generate-usage-display.js
// Load AFTER js/taxonomy.browser.js — depends on window.TAXONOMY.canonicalize.
// Exposes window.UsageDisplay (namespaced — no bare globals).

(function (root) {
  var allowHours = [
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
    'Crawler Loader',
    'Side by Side'
  ];
  var allowMileage = [
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
    'Classic Car'
  ];
  var suppressBoth = [
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
  ];

  function normalizeSubcategory(unit) {
    var raw = String((unit && unit.subcategory) || '').trim();
    if (!raw) return '';
    var canonicalize = (root.TAXONOMY && root.TAXONOMY.canonicalize) || null;
    if (!canonicalize) {
      console.error('[usage-display] window.TAXONOMY.canonicalize missing — load js/taxonomy.browser.js BEFORE js/usage-display.browser.js');
      return '';
    }
    var canonical = canonicalize(raw);
    return canonical || '';
  }

  function hasRealNumber(v) {
    if (v == null) return false;
    var s = String(v).trim();
    if (s === '') return false;
    var numPart = s.replace(/[^0-9.]/g, '');
    return numPart !== '' && Number(numPart) !== 0;
  }

  function showMileage(unit) {
    var sub = normalizeSubcategory(unit);
    if (!sub) {
      console.warn('[usage-display] unmapped subcategory: ' + ((unit && unit.subcategory) || '(none)'));
      return false;
    }
    if (allowMileage.indexOf(sub) === -1) return false;
    return hasRealNumber(unit.mileage);
  }

  function showHours(unit) {
    var sub = normalizeSubcategory(unit);
    if (!sub) {
      console.warn('[usage-display] unmapped subcategory: ' + ((unit && unit.subcategory) || '(none)'));
      return false;
    }
    if (allowHours.indexOf(sub) === -1) return false;
    return hasRealNumber(unit.hours);
  }

  // Conservative variants — see CJS mirror for full rationale.
  function isKnownSuppressMileage(unit) {
    var sub = normalizeSubcategory(unit);
    if (!sub) return false;
    return allowHours.indexOf(sub) !== -1 || suppressBoth.indexOf(sub) !== -1;
  }

  function isKnownSuppressHours(unit) {
    var sub = normalizeSubcategory(unit);
    if (!sub) return false;
    return allowMileage.indexOf(sub) !== -1 || suppressBoth.indexOf(sub) !== -1;
  }

  // Pure subcategory classifier — see CJS mirror for full rationale.
  function usageClass(unit) {
    var sub = normalizeSubcategory(unit);
    if (!sub) return 'neither';
    if (allowHours.indexOf(sub)   !== -1) return 'hours-based';
    if (allowMileage.indexOf(sub) !== -1) return 'odometer';
    return 'neither';
  }

  root.UsageDisplay = {
    showMileage: showMileage,
    showHours: showHours,
    isKnownSuppressMileage: isKnownSuppressMileage,
    isKnownSuppressHours: isKnownSuppressHours,
    usageClass: usageClass,
    normalizeSubcategory: normalizeSubcategory
  };
}(typeof window !== 'undefined' ? window : this));
