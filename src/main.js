// Assume global variables:
// - Globe from globe.gl
// - d3 from d3
// - satellite from satellite.js
// - THREE from three.js

console.log("main.js version 2");

const SATELLITE_LIMIT = 12000;

const COUNTRY_ALIASES = {
  'united states of america': 'usa',
  'russian federation': 'russia',
  'korea, republic of': 'south korea',
  'korea, democratic people\'s republic of': 'north korea',
  'iran (islamic republic of)': 'iran'
};

const getCanonicalCountry = name => {
  const key = name.trim().toLowerCase();
  return COUNTRY_ALIASES[key] || key;
};

async function loadMetadata() {
  const res = await fetch('./public/data/ucs_metadata.json');
  return await res.json();
}

async function loadSatellites(metadata) {
  const tleText = await d3.text('./public/data/tle.txt');
  const lines = tleText.trim().split('\n');
  const entries = [];

  for (let i = 0; i < lines.length; i += 3) {
    const name = lines[i].trim();
    const line1 = lines[i + 1]?.trim();
    const line2 = lines[i + 2]?.trim();

    if (line1 && line2) {
      const noradId = parseInt(line1.substring(2, 7), 10);
      entries.push({ name, line1, line2, noradId });
    }
  }

  const now = new Date();
  const gmst = satellite.gstime(now);

  return entries.slice(0, SATELLITE_LIMIT).map(({ name, line1, line2, noradId }) => {
    try {
      const satrec = satellite.twoline2satrec(line1, line2);
      const meta = metadata[noradId] || {};

      // Compute altitude if possible
      let altitudeKm = null;
      try {
        const position = satellite.propagate(satrec, now).position;
        if (position) {
          const geo = satellite.eciToGeodetic(position, gmst);
          altitudeKm = geo.height;
        }
      } catch {
        // Leave altitudeKm as null
      }

      // Set orbit_class from altitude if not already meaningful
      if (!meta.orbit_class || meta.orbit_class.toLowerCase().includes('unknown')) {
        if (altitudeKm !== null) {
          if (altitudeKm <= 2000) {
            meta.orbit_class = 'LEO';
          } else if (altitudeKm < 35000) {
            meta.orbit_class = 'MEO';
          } else if (altitudeKm >= 35000 && altitudeKm <= 36000) {
            meta.orbit_class = 'GEO';
          }
        }
      }

      // Fallbacks for Starlink satellites
      const isStarlink = name.toLowerCase().includes('starlink');
      if (isStarlink) {
        if (!meta.country) meta.country = 'USA';
        if (!meta.operator) meta.operator = 'SpaceX';
        if (!meta.users) meta.users = 'Commercial';
        if (!meta.purpose) meta.purpose = 'Communications';
      }

      const ownerCountries = (meta.country || '')
        .split(/[,/]/)
        .map(c => c.trim().toLowerCase());

      return { name, satrec, noradId, meta, ownerCountries };
    } catch {
      return null;
    }
  }).filter(Boolean);
}

function getGlobePosition(globe, lat, lng, altKm) {
  const altRadii = altKm / 6371;
  const pos = globe.getCoords(lat, lng, altRadii);
  return new THREE.Vector3(pos.x, pos.y, pos.z);
}

function updateSatelliteCountDisplay(canonicalName) {
  const display = document.getElementById("sat-count-display");

  if (!canonicalName) {
    display.textContent = "Satellites: ";
    return;
  }

  const count = satRecords.filter(s =>
    s.ownerCountries?.some(c => c === canonicalName || c.includes(canonicalName))
  ).length;

  display.textContent = `Satellites: ${count}`;
}

function updateFilteredSatelliteColors(type, value) {
  for (let i = 0; i < satRecords.length; i++) {
    const record = satRecords[i];
    const match = (record.meta[type] || '').toLowerCase().includes(value.toLowerCase());
    mesh.setColorAt(i, new THREE.Color(match ? 'limegreen' : 'red'));
  }
  mesh.instanceColor.needsUpdate = true;
}

function updateSatelliteCountDisplayFromFilter(type, value) {
  const count = satRecords.filter(s =>
    (s.meta[type] || '').toLowerCase().includes(value.toLowerCase())
  ).length;

  const display = document.getElementById("sat-count-display");
  display.textContent = `Satellites: ${count}`;
}

function clearActiveFilterButtons() {
  document.querySelectorAll('#filters button').forEach(b => b.classList.remove('active'));
  filterSelected = false;
}

let satRecords = [];
let mesh;
let selectedFilter = null;
let filterSelected = false;

async function main() {
  const metadata = await loadMetadata();
  satRecords = await loadSatellites(metadata);
  document.getElementById("sat-count").textContent = satRecords.length;

  const tooltip = document.getElementById('tooltip');
  tooltip.style.display = 'none';
  tooltip.textContent = '';

  const countries = await fetch(
    "https://raw.githubusercontent.com/vasturiano/globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson"
  ).then(res => res.json());

  let selectedCountry = null;
  let hoveredCountry = null;
  let selectedId = null;

  let mouseDownPos = null;

  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  const geometry = new THREE.SphereGeometry(0.3, 4, 4);
  const material = new THREE.MeshPhongMaterial({ color: 'white' });
  mesh = new THREE.InstancedMesh(geometry, material, satRecords.length);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = satRecords.length;
  mesh.frustumCulled = false;

  const sizeSlider = document.getElementById('size-slider');
  sizeSlider.addEventListener('input', () => {
    const newSize = parseFloat(sizeSlider.value);
    const newGeometry = new THREE.SphereGeometry(newSize, 4, 4);
    mesh.geometry.dispose();
    mesh.geometry = newGeometry;
  });

  const globe = Globe()
    .globeImageUrl('//cdn.jsdelivr.net/npm/three-globe/example/img/earth-night.jpg')
    .width(window.innerWidth)
    .height(window.innerHeight)
    (document.getElementById("globeViz"))
    .polygonsData(countries.features)
    .polygonCapColor(d => {
      if (d === selectedCountry) return 'green';
      if (!selectedCountry && d === hoveredCountry) return 'green';
      return 'rgba(255, 253, 173, 1)';
    })
    .polygonSideColor(() => 'rgba(0, 100, 0, 0.15)')
    .polygonStrokeColor(() => '#111')
    .polygonAltitude(d => d === selectedCountry || d === hoveredCountry ? 0.03 : 0.02)
    .polygonsTransitionDuration(300)
    .onPolygonClick(polygon => {
      mouse.x = (lastClickX / window.innerWidth) * 2 - 1;
      mouse.y = -(lastClickY / window.innerHeight) * 2 + 1;
      raycaster.setFromCamera(mouse, globe.camera());
      const hits = raycaster.intersectObject(mesh);
      if (hits.length > 0 && hits[0].instanceId !== undefined) return;

      const canonical = getCanonicalCountry(polygon?.properties?.ADMIN || '');
      if (selectedCountry === polygon) {
        selectedCountry = null;
        globe
          .polygonAltitude(() => 0.02)
          .polygonCapColor(() => 'rgba(255, 253, 173, 1)');
        updateSatelliteColors(null);
        updateSatelliteCountDisplay(null); // NEW
        clearActiveFilterButtons();
      } else {
        selectedCountry = polygon;
        globe
          .polygonAltitude(d => d === selectedCountry || d === hoveredCountry ? 0.03 : 0.02)
          .polygonCapColor(d => {
            if (d === selectedCountry) return 'green';
            if (!selectedCountry && d === hoveredCountry) return 'green';
            return 'rgba(255, 253, 173, 1)';
          });
        updateSatelliteColors(canonical);
        updateSatelliteCountDisplay(canonical); // NEW
        clearActiveFilterButtons();
      }
    })
    .onPolygonHover(polygon => {
      hoveredCountry = polygon;
      globe
        .polygonAltitude(d => d === selectedCountry || d === hoveredCountry ? 0.03 : 0.02)
        .polygonCapColor(d => {
          if (d === selectedCountry) return 'green';
          if (!selectedCountry && d === hoveredCountry && !filterSelected) return 'green';
          return 'rgba(255, 253, 173, 1)';
        });

      if (!selectedCountry && polygon && !filterSelected) {
        const canonical = getCanonicalCountry(polygon?.properties?.ADMIN || '');
        updateSatelliteColors(canonical);
        updateSatelliteCountDisplay(canonical); // NEW
      } else if (!selectedCountry && !filterSelected) {
        updateSatelliteColors(null);
        updateSatelliteCountDisplay(null); // NEW
      }
    });

  const colorAttr = new Float32Array(satRecords.length * 3);
  for (let i = 0; i < satRecords.length; i++) {
    new THREE.Color('red').toArray(colorAttr, i * 3);
  }
  mesh.instanceColor = new THREE.InstancedBufferAttribute(colorAttr, 3);
  globe.scene().add(mesh);

  const matrix = new THREE.Matrix4();
  function updatePositions() {
    const now = new Date();
    const gmst = satellite.gstime(now);
    let i = 0;

    for (const { satrec } of satRecords) {
      const { position } = satellite.propagate(satrec, now);
      if (!position) continue;

      const posGd = satellite.eciToGeodetic(position, gmst);
      const lat = satellite.degreesLat(posGd.latitude);
      const lng = satellite.degreesLong(posGd.longitude);
      const alt = posGd.height;

      const pos = getGlobePosition(globe, lat, lng, alt);
      matrix.setPosition(pos);
      mesh.setMatrixAt(i, matrix);
      i++;
    }

    mesh.instanceMatrix.needsUpdate = true;
  }

  updatePositions();
  setInterval(updatePositions, 1000);

  const camera = globe.camera();
  let lastClickX = 0, lastClickY = 0;

  window.addEventListener('mousedown', (e) => {
    mouseDownPos = { x: e.clientX, y: e.clientY };
  });

  window.addEventListener('mouseup', (e) => {
    const dx = e.clientX - mouseDownPos.x;
    const dy = e.clientY - mouseDownPos.y;
    const isStaticClick = dx * dx + dy * dy < 25;

    lastClickX = e.clientX;
    lastClickY = e.clientY;

    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObject(mesh);

    if (hits.length > 0 && hits[0].instanceId !== undefined) {
      const i = hits[0].instanceId;

      if (selectedId !== null && selectedId !== i) {
        const prev = satRecords[selectedId];
        const isOwned = selectedCountry && prev.ownerCountries?.some(c =>
          c === getCanonicalCountry(selectedCountry.properties.ADMIN)
        );
        mesh.setColorAt(selectedId, new THREE.Color(isOwned ? 'limegreen' : 'red'));
      }

      selectedId = i;
      mesh.setColorAt(i, new THREE.Color('blue'));
      mesh.instanceColor.needsUpdate = true;

      const { name, meta } = satRecords[i];
      tooltip.innerHTML = `
        <b>${meta.official_name || name}</b><br/>
        <b>Country:</b> ${meta.country || '—'}<br/>
        <b>Owner:</b> ${meta.operator || '—'}<br/>
        <b>Users:</b> ${meta.users || '—'}<br/>
        <b>Purpose:</b> ${meta.purpose || '—'}<br/>
        <b>Orbit:</b> ${meta.orbit_class || '—'}, ${meta.orbit_type || '—'}<br/>
        <b>Launch:</b> ${meta.launch_date || '—'}<br/>
        <b>Description:</b> ${meta.comments || '—'}
      `;
      tooltip.style.left = `${e.clientX + 10}px`;
      tooltip.style.top = `${e.clientY + 10}px`;
      tooltip.style.display = 'block';
    } else if (isStaticClick) {
      if (selectedId !== null) {
        const prev = satRecords[selectedId];
        const isOwned = selectedCountry && prev.ownerCountries?.some(c =>
          c === getCanonicalCountry(selectedCountry.properties.ADMIN)
        );
        mesh.setColorAt(selectedId, new THREE.Color(isOwned ? 'limegreen' : 'red'));
        mesh.instanceColor.needsUpdate = true;
        selectedId = null;
        tooltip.style.display = 'none';
      } else if (selectedCountry) {
        selectedCountry = null;
        globe
          .polygonAltitude(() => 0.02)
          .polygonCapColor(() => 'rgba(255, 253, 173, 1)');
        updateSatelliteColors(null);
        updateSatelliteCountDisplay(null); // NEW
      }
    }
  });

  window.addEventListener('mousemove', (event) => {
    if (selectedId !== null) return;

    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObject(mesh);

    if (hits.length > 0 && hits[0].instanceId !== undefined) {
      const i = hits[0].instanceId;
      const { name, meta } = satRecords[i];
      const point = hits[0].point.clone().project(camera);
      tooltip.innerHTML = `
        <b>${meta.official_name || name}</b><br/>
        <b>Country:</b> ${meta.country || '—'}<br/>
        <b>Owner:</b> ${meta.operator || '—'}<br/>
        <b>Users:</b> ${meta.users || '—'}<br/>
        <b>Purpose:</b> ${meta.purpose || '—'}<br/>
        <b>Orbit:</b> ${meta.orbit_class || '—'}, ${meta.orbit_type || '—'}<br/>
        <b>Launch:</b> ${meta.launch_date || '—'}<br/>
        <b>Description:</b> ${meta.comments || '—'}
      `;
      tooltip.style.left = `${(point.x * 0.5 + 0.5) * window.innerWidth + 10}px`;
      tooltip.style.top = `${(-point.y * 0.5 + 0.5) * window.innerHeight + 10}px`;
      tooltip.style.display = 'block';
    } else if (hoveredCountry) {
      tooltip.innerHTML = `<b>${hoveredCountry.properties.ADMIN}</b>`;
      tooltip.style.left = `${event.clientX + 10}px`;
      tooltip.style.top = `${event.clientY + 10}px`;
      tooltip.style.display = 'block';
    } else {
      tooltip.style.display = 'none';
    }
  });

  function updateSatelliteColors(canonicalName) {
    for (let i = 0; i < satRecords.length; i++) {
      if (i === selectedId) continue;  // Preserve selected satellite as blue
  
      const record = satRecords[i];
      const isMatch = canonicalName && record.ownerCountries?.some(c =>
        c === canonicalName || c.includes(canonicalName)
      );
      const color = isMatch ? 'limegreen' : 'red';
      mesh.setColorAt(i, new THREE.Color(color));
    }
    mesh.instanceColor.needsUpdate = true;
  }

  document.querySelectorAll('#filters button').forEach(btn => {
    btn.addEventListener('click', () => {
      // Visually highlight only this button
      document.querySelectorAll('#filters button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
  
      // Set filter selection
      const type = btn.getAttribute('data-type');
      const value = btn.getAttribute('data-value');
      selectedFilter = { type, value };
      filterSelected = true;
  
      // Clear country selections
      selectedCountry = null;
      hoveredCountry = null;
  
      globe
        .polygonAltitude(() => 0.02)
        .polygonCapColor(() => 'rgba(255, 253, 173, 1)');
  
      updateFilteredSatelliteColors(type, value);
      updateSatelliteCountDisplayFromFilter(type, value);
    });
  });  

  document.getElementById("clear-selection-btn").addEventListener("click", () => {
    selectedCountry = null;
    hoveredCountry = null;
    selectedFilter = null;
    filterSelected = false;
  
    document.querySelectorAll('#filters button').forEach(b => b.classList.remove('active'));
  
    // Reset polygon visuals
    globe
      .polygonAltitude(() => 0.02)
      .polygonCapColor(() => 'rgba(255, 253, 173, 1)');
  
    // Reset satellite colors to default (red)
    for (let i = 0; i < satRecords.length; i++) {
      mesh.setColorAt(i, new THREE.Color('red'));
    }
    mesh.instanceColor.needsUpdate = true;
  
    // Clear satellite count
    const display = document.getElementById("sat-count-display");
    display.textContent = "Satellites: ";
  });  
  
}

main();
