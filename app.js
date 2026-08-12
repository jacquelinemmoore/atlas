/* =========================================================
   Atlas — Personal Museum & Historical Site Map
   app.js

   Features:
   - Unified create/edit editor
   - Data migration
   - Responsive map markers
   - Wax seal + compass icons

   Clean rewrite:
   - unified editor state
   - Wikipedia first sentence summaries
   - manual-only Selected Stops
   - wax seal + compass markers
   - LocalStorage persistence
   ========================================================= */


let sites = [];

let editingSiteId = null;
let pendingSite = null;

// Legend acts as a filter: unchecking a status hides those pins from the map.
const visibleStatuses = {
  visited:true,
  wantToVisit:true
};





/* =========================================================
   Map
   ========================================================= */


const map = L.map("map", {
  worldCopyJump:true,
  zoomControl:false
}).setView([30,10],2.5);


L.control.zoom({ position:"bottomleft" }).addTo(map);


const LegendControl = L.Control.extend({

  options:{ position:"topleft" },

  onAdd:function(){

    const div =
      L.DomUtil.create("div","map-legend");

    div.innerHTML = `
      <button type="button" class="legend-item" data-status="visited">
        <span class="legend-icon" id="legend-icon-visited"></span>
        Visited
      </button>
      <button type="button" class="legend-item" data-status="wantToVisit">
        <svg class="legend-icon" viewBox="0 0 40 40">
          <use href="#icon-compass-star"></use>
        </svg>
        Want to visit
      </button>
    `;

    L.DomEvent.disableClickPropagation(div);

    div.querySelectorAll(".legend-item").forEach(btn => {

      btn.addEventListener("click", () => {

        const status = btn.dataset.status;
        visibleStatuses[status] = !visibleStatuses[status];

        btn.classList.toggle(
          "legend-item-inactive",
          !visibleStatuses[status]
        );

        renderPins();

      });

    });

    return div;

  }

});

new LegendControl().addTo(map);



L.tileLayer(
  "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  {
    maxZoom:18,
    attribution:"&copy; OpenStreetMap contributors"
  }
).addTo(map);



const markerLayer =
  L.layerGroup()
    .addTo(map);





function markerSize(){

  return Math.max(
    18,
    Math.min(
      36,
      10 + map.getZoom() * 2
    )
  );

}





function pinHtml(status,size,count){

  const inner =
    status === "visited"
    ? `
      <div class="atlas-pin-seal" style="width:100%;height:100%">
        <img src="assets/wax-seal.png" alt="">
        <svg class="seal-emblem" viewBox="0 0 40 40">
          <use href="#icon-compass"></use>
        </svg>
      </div>
    `
    : `
      <svg width="100%" height="100%" viewBox="0 0 40 40">
        <use href="#icon-compass-star"></use>
      </svg>
    `;

  const badge =
    count > 1
    ? `<span class="pin-badge">${count > 99 ? "99+" : count}</span>`
    : "";

  return `
    <div class="atlas-pin-wrap" style="width:${size}px;height:${size}px">
      ${inner}
      ${badge}
    </div>
  `;

}





function iconFor(status,count){

  const size =
    markerSize();


  return L.divIcon({

    className:"atlas-pin",

    html:
      pinHtml(
        status,
        size,
        count || 1
      ),

    iconSize:[
      size,
      size
    ],

    iconAnchor:[
      size / 2,
      size * .85
    ]

  });

}




// Group sites that would visually overlap at the current zoom (same status,
// within a small pixel radius) so they render as one pin with a count badge
// instead of a stack of indistinguishable icons.
function clusterSitesForDisplay(){

  const threshold = 26; // px

  const visibleSites =
    sites.filter(
      site => visibleStatuses[site.status]
    );

  const points = visibleSites.map(site => ({
    site,
    pt: map.latLngToContainerPoint([site.lat, site.lng])
  }));

  const used = new Array(points.length).fill(false);
  const clusters = [];

  for(let i = 0; i < points.length; i++){

    if(used[i]) continue;
    used[i] = true;
    const group = [points[i]];

    for(let j = i + 1; j < points.length; j++){

      if(used[j]) continue;
      if(points[i].site.status !== points[j].site.status) continue;

      const dx = points[i].pt.x - points[j].pt.x;
      const dy = points[i].pt.y - points[j].pt.y;

      if(Math.sqrt(dx*dx + dy*dy) < threshold){
        group.push(points[j]);
        used[j] = true;
      }

    }

    clusters.push(group);

  }

  return clusters;

}




map.on(
  "zoomend",
  renderPins
);




map.on(
  "moveend",
  renderPins
);





/* =========================================================
   Render markers
   ========================================================= */


function renderPins(){

  markerLayer.clearLayers();


  const clusters =
    clusterSitesForDisplay();


  clusters.forEach(group => {

    if(group.length === 1){

      const site = group[0].site;

      const marker =
        L.marker(
          [
            site.lat,
            site.lng
          ],
          {
            icon:
              iconFor(site.status, 1)
          }
        );

      marker.bindTooltip(
        `
        <p class="tooltip-name">
          ${escapeHtml(site.name)}
        </p>

        <p class="tooltip-location">
          ${escapeHtml(site.city)}
          ${site.country ? ", " + escapeHtml(site.country) : ""}
        </p>

        <p class="tooltip-summary">
          ${escapeHtml(site.abstract || "")}
        </p>
        `,
        {
          direction:"top",
          offset:[0,-8]
        }
      );

      marker.on(
        "click",
        () =>
          openEditor(site.id)
      );

      marker.addTo(markerLayer);

      return;

    }


    // Multiple overlapping pins of the same status: show one marker with
    // a count badge, centered on the group, and zoom in on click to
    // reveal the individual sites.
    const avgLat =
      group.reduce((sum,g) => sum + g.site.lat, 0) / group.length;

    const avgLng =
      group.reduce((sum,g) => sum + g.site.lng, 0) / group.length;

    const status = group[0].site.status;

    const marker =
      L.marker(
        [avgLat, avgLng],
        { icon: iconFor(status, group.length) }
      );

    const names =
      group.map(g => escapeHtml(g.site.name)).join(", ");

    marker.bindTooltip(
      `
      <p class="tooltip-name">${group.length} sites here</p>
      <p class="tooltip-summary">${names}</p>
      `,
      {
        direction:"top",
        offset:[0,-8]
      }
    );

    marker.on(
      "click",
      () => {

        const container =
          document.createElement("div");
        container.className = "cluster-popup";
        group.forEach(g => {

          const btn =
            document.createElement("button");
          btn.type = "button";
          btn.className = "cluster-popup-item";
          btn.textContent =
            g.site.city
            ? `${g.site.name} (${g.site.city})`
            : g.site.name;

          btn.addEventListener(
            "click",
            () => {
              map.closePopup();
              openEditor(g.site.id);
            }
          );

          container.appendChild(btn);

        });

        L.popup({ closeButton:true, maxWidth:260 })
          .setLatLng([avgLat, avgLng])
          .setContent(container)
          .openOn(map);

      }
    );

    marker.addTo(markerLayer);

  });

}






/* =========================================================
   Storage
   ========================================================= */


async function loadSites(){

  try{

    const res = await fetch("/api/sites");
    const stored = await res.json();


    if(!Array.isArray(stored))
      return [];


    return stored.map(normalizeSite);


  }
  catch{

    return [];

  }

}





function normalizeSite(site){

  return {

    id:
      site.id ||
      crypto.randomUUID(),


    name:
      site.name || "",


    city:
      site.city || "",


    country:
      site.country || "",


    lat:
      Number(site.lat) || 0,


    lng:
      Number(site.lng) || 0,


    abstract:
      firstSentence(
        site.abstract || ""
      ),


    // deliberately ignore old knownFor data
    selectedStops:
      Array.isArray(site.selectedStops)
      ? site.selectedStops
      : [],


    imageUrl:
      site.imageUrl || "",


    imagePosition:
      site.imagePosition ||
      "50% 50%",


    status:
      site.status ||
      "wantToVisit",


    visits:
      Array.isArray(site.visits)
      ? site.visits
      : [],


    createdAt:
      site.createdAt ||
      todayISO(),


    updatedAt:
      site.updatedAt ||
      todayISO()

  };

}





function saveSites(){

  fetch("/api/sites", {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify(sites, null, 2)
  }).catch(
    err => console.error("Failed to save sites:", err)
  );

}






/* =========================================================
   Editor references
   ========================================================= */


const editorModal =
  document.getElementById(
    "editor-modal"
  );


const editorImage =
  document.getElementById(
    "editor-image"
  );


const editorName =
  document.getElementById(
    "editor-name"
  );


const editorLocation =
  document.getElementById(
    "editor-location"
  );


const editorAbstract =
  document.getElementById(
    "editor-abstract"
  );


const editorAbstractDisplay =
  document.getElementById(
    "editor-abstract-display"
  );


const editorStops =
  document.getElementById(
    "editor-stops"
  );


const editorStopsDisplay =
  document.getElementById(
    "editor-stops-display"
  );


const editorImageUpload =
  document.getElementById(
    "editor-image-upload"
  );


const visitHistorySection =
  document.getElementById(
    "visit-history-section"
  );






/* =========================================================
   Editor
   ========================================================= */


function createEmptySite(){

  return {

    id:
      crypto.randomUUID(),

    name:"",
    city:"",
    country:"",

    lat:0,
    lng:0,

    abstract:"",
    selectedStops:[],

    imageUrl:"",
    imagePosition:"50% 50%",

    status:"wantToVisit",

    visits:[],

    createdAt:
      todayISO(),

    updatedAt:
      todayISO()

  };

}





function openEditor(siteId=null){

  editingSiteId =
    siteId;



  pendingSite =
    siteId
    ? structuredClone(
        sites.find(
          s => s.id === siteId
        )
      )
    : createEmptySite();



  populateEditor();


  editorModal.hidden=false;

  const card =
    editorModal.querySelector(".panel-card");

  if(card)
    card.scrollTop = 0;

}





function populateEditor(){

  if(!pendingSite)
    return;



  editorName.textContent =
    pendingSite.name ||
    "New Site";



  editorLocation.textContent =
    [
      pendingSite.city,
      pendingSite.country
    ]
    .filter(Boolean)
    .join(", ");



  editorImage.src =
    pendingSite.imageUrl ||
    placeholderImage();



  editorImage.style.objectPosition =
    pendingSite.imagePosition;



  editorAbstract.value =
    pendingSite.abstract || "";


  renderAbstractDisplay();

  editorAbstract.hidden = true;
  editorAbstractDisplay.hidden = false;



  editorStops.value =
    pendingSite.selectedStops.join("\n");


  renderStopsDisplay();

  editorStops.hidden = true;
  editorStopsDisplay.hidden = false;



  document
    .querySelectorAll(
      'input[name="status"]'
    )
    .forEach(input => {

      input.checked =
        input.value === pendingSite.status;

    });



  updateVisitedDateVisibility();

  renderVisitHistory();

}


/* =========================================================
   Inline-editable Abstract & Selected Stops
   ========================================================= */


function renderAbstractDisplay(){

  const text =
    pendingSite?.abstract || "";

  if(text){

    editorAbstractDisplay.textContent = text;
    editorAbstractDisplay.classList.remove("placeholder-text");

  }
  else{

    editorAbstractDisplay.textContent =
      "Click to add a one-sentence summary.";
    editorAbstractDisplay.classList.add("placeholder-text");

  }

}


function renderStopsDisplay(){

  editorStopsDisplay.innerHTML = "";

  const stops =
    pendingSite?.selectedStops || [];

  if(stops.length === 0){

    const li = document.createElement("li");
    li.textContent = "Click to list what you want to see here.";
    li.classList.add("placeholder-text");
    li.style.listStyle = "none";
    li.style.marginLeft = "-1.75rem";
    editorStopsDisplay.appendChild(li);

  }
  else{

    stops.forEach(stop => {

      const li = document.createElement("li");
      li.textContent = stop;
      editorStopsDisplay.appendChild(li);

    });

  }

}


function enterAbstractEdit(){

  editorAbstractDisplay.hidden = true;
  editorAbstract.hidden = false;
  editorAbstract.value = pendingSite?.abstract || "";
  editorAbstract.focus();

}


function exitAbstractEdit(){

  if(!pendingSite) return;

  pendingSite.abstract =
    firstSentence(editorAbstract.value.trim());

  renderAbstractDisplay();

  editorAbstract.hidden = true;
  editorAbstractDisplay.hidden = false;

}


function enterStopsEdit(){

  editorStopsDisplay.hidden = true;
  editorStops.hidden = false;
  editorStops.value =
    (pendingSite?.selectedStops || []).join("\n");
  editorStops.focus();

}


function exitStopsEdit(){

  if(!pendingSite) return;

  pendingSite.selectedStops =
    editorStops.value
      .split("\n")
      .map(item => item.trim())
      .filter(Boolean);

  renderStopsDisplay();

  editorStops.hidden = true;
  editorStopsDisplay.hidden = false;

}


editorAbstractDisplay.addEventListener("click", enterAbstractEdit);
editorAbstractDisplay.addEventListener("keydown", (e) => {
  if(e.key === "Enter" || e.key === " "){
    e.preventDefault();
    enterAbstractEdit();
  }
});
editorAbstract.addEventListener("blur", exitAbstractEdit);


editorStopsDisplay.addEventListener("click", enterStopsEdit);
editorStopsDisplay.addEventListener("keydown", (e) => {
  if(e.key === "Enter" || e.key === " "){
    e.preventDefault();
    enterStopsEdit();
  }
});
editorStops.addEventListener("blur", exitStopsEdit);

/* =========================================================
   Status controls
   ========================================================= */


document
  .querySelectorAll(
    'input[name="status"]'
  )
  .forEach(input => {


    input.addEventListener(
      "change",
      () => {


        if(!pendingSite)
          return;



        pendingSite.status =
          input.value;



        updateVisitedDateVisibility();



        if(
          input.value === "visited" &&
          input.checked
        ){

          setTimeout(
            scrollEditorToVisitDate,
            150
          );

        }


      }
    );


  });







function updateVisitedDateVisibility(){

  const status =
    document.querySelector(
      'input[name="status"]:checked'
    )?.value;


  visitHistorySection.hidden =
    status !== "visited";

}




function scrollEditorToVisitDate(){

  const card =
    editorModal.querySelector(
      ".panel-card"
    );


  if(!card)
    return;



  visitHistorySection.scrollIntoView({

    behavior:"smooth",

    block:"center"

  });

}




/* =========================================================
   Visit history list + Log Visit
   ========================================================= */


const detailVisitsList =
  document.getElementById(
    "detail-visits"
  );


const logVisitDateInput =
  document.getElementById(
    "log-visit-date"
  );


const logVisitBtn =
  document.getElementById(
    "log-visit-btn"
  );


function renderVisitHistory(){

  if(!pendingSite)
    return;


  detailVisitsList.innerHTML = "";


  if(pendingSite.visits.length === 0){

    const li =
      document.createElement("li");

    li.textContent =
      "Not logged yet";

    li.classList.add("placeholder-text");

    li.style.border = "none";

    detailVisitsList.appendChild(li);

    return;

  }


  [...pendingSite.visits]
    .sort()
    .reverse()
    .forEach(date => {

      const li =
        document.createElement("li");


      const span =
        document.createElement("span");

      span.textContent =
        formatVisitDate(date);


      const removeBtn =
        document.createElement("button");

      removeBtn.type = "button";
      removeBtn.textContent = "remove";

      removeBtn.addEventListener(
        "click",
        () => {

          pendingSite.visits =
            pendingSite.visits.filter(
              d => d !== date
            );

          renderVisitHistory();

        }
      );


      li.appendChild(span);
      li.appendChild(removeBtn);
      detailVisitsList.appendChild(li);

    });

}


function formatVisitDate(iso){

  const d =
    new Date(iso + "T00:00:00");

  return d.toLocaleDateString(
    undefined,
    {
      year:"numeric",
      month:"short",
      day:"numeric"
    }
  );

}


logVisitBtn.addEventListener(
  "click",
  () => {

    if(!pendingSite)
      return;

    if(!logVisitDateInput.value)
      return;


    if(
      !pendingSite.visits.includes(
        logVisitDateInput.value
      )
    ){

      pendingSite.visits.push(
        logVisitDateInput.value
      );

    }


    pendingSite.status = "visited";

    document
      .querySelector(
        'input[name="status"][value="visited"]'
      ).checked = true;

    updateVisitedDateVisibility();


    renderVisitHistory();


    logVisitDateInput.value = "";

  }
);






/* =========================================================
   Save editor
   ========================================================= */


document
  .getElementById(
    "editor-save"
  )
  .addEventListener(
    "click",
    saveEditor
  );





function saveEditor(){

  if(!pendingSite)
    return;


  // Commit any inline field the user is still actively editing
  // before reading its value.
  if(document.activeElement === editorAbstract)
    exitAbstractEdit();

  if(document.activeElement === editorStops)
    exitStopsEdit();



  pendingSite.abstract =
    firstSentence(
      editorAbstract.value.trim()
    );



  pendingSite.selectedStops =
    editorStops.value

      .split("\n")

      .map(
        item => item.trim()
      )

      .filter(Boolean);



  pendingSite.status =
    document.querySelector(
      'input[name="status"]:checked'
    ).value;



  pendingSite.updatedAt =
    todayISO();



  if(editingSiteId){

    const index =
      sites.findIndex(
        s =>
        s.id === editingSiteId
      );


    sites[index] =
      pendingSite;


  }
  else{

    sites.push(
      pendingSite
    );

  }



  saveSites();

  renderPins();

  closeEditor();

}







function closeEditor(){

  editorModal.hidden=true;

  pendingSite=null;

  editingSiteId=null;

}






document
  .getElementById(
    "editor-close"
  )
  .addEventListener(
    "click",
    closeEditor
  );



document
  .getElementById(
    "editor-cancel"
  )
  .addEventListener(
    "click",
    closeEditor
  );






editorModal.addEventListener(
  "click",
  e => {

    if(e.target === editorModal){

      if(pendingSite){
        saveEditor(); // saves and closes
      }
      else{
        closeEditor();
      }

    }

  }
);





document.addEventListener(
  "keydown",
  e => {

    if(
      e.key === "Escape" &&
      !editorModal.hidden
    ){

      closeEditor();

    }

  }
);







/* =========================================================
   Delete
   ========================================================= */


document
  .getElementById(
    "delete-pin-btn"
  )
  ?.addEventListener(
    "click",
    () => {


      if(!editingSiteId)
        return;



      if(
        !confirm(
          "Remove this pin?"
        )
      )
        return;



      sites =
        sites.filter(
          site =>
          site.id !== editingSiteId
        );



      saveSites();

      renderPins();

      closeEditor();


    }
  );







/* =========================================================
   Image upload
   ========================================================= */


editorImageUpload
?.addEventListener(
  "change",
  () => {


    const file =
      editorImageUpload.files[0];


    if(!file)
      return;



    const reader =
      new FileReader();



    reader.onload =
      () => {


        pendingSite.imageUrl =
          reader.result;


        editorImage.src =
          reader.result;


      };



    reader.readAsDataURL(file);


  }
);







/* =========================================================
   Search
   ========================================================= */


const searchForm =
  document.getElementById(
    "search-form"
  );


const searchInput =
  document.getElementById(
    "search-input"
  );


const searchResults =
  document.getElementById(
    "search-results"
  );





searchForm.addEventListener(
  "submit",
  async e => {


    e.preventDefault();


    const query =
      searchInput.value.trim();



    if(!query)
      return;



    searchResults.hidden=false;


    searchResults.innerHTML =
      "<button disabled>Searching...</button>";



    try{


      const response =
        await fetch(
          `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&namedetails=1&limit=6&q=${encodeURIComponent(query)}`
        );



      const results =
        await response.json();



      renderSearchResults(results);


    }
    catch{


      searchResults.innerHTML =
        "<button disabled>Search failed</button>";

    }


  }
);






function renderSearchResults(results){

  searchResults.innerHTML="";


  if(!results.length){

    searchResults.innerHTML =
      "<button disabled>No results</button>";

    return;

  }



  results.forEach(result => {


    const button =
      document.createElement(
        "button"
      );


    button.textContent =
      result.display_name;



    button.onclick =
      () =>
        chooseSearchResult(result);



    searchResults.appendChild(
      button
    );


  });

}







// Same name (case-insensitive) and within roughly ~1km — almost certainly
// the same real-world site, not a coincidence.
function findPossibleDuplicate(name, lat, lng){

  const nameLower =
    name.trim().toLowerCase();

  return sites.find(s => {

    if(s.name.trim().toLowerCase() !== nameLower)
      return false;

    const dLat = Math.abs(s.lat - lat);
    const dLng = Math.abs(s.lng - lng);

    return dLat < 0.01 && dLng < 0.01;

  });

}



async function chooseSearchResult(result){

  searchResults.hidden=true;

  searchInput.value="";



  const address =
    result.address || {};


  const name =
    result.namedetails?.name ||
    result.display_name.split(",")[0];


  const lat =
    Number(result.lat);


  const lng =
    Number(result.lon);



  const duplicate =
    findPossibleDuplicate(name, lat, lng);


  if(duplicate){

    const openExisting =
      confirm(
        `You already have a pin for "${duplicate.name}" near here.\n\n` +
        `OK \u2014 open that existing pin\n` +
        `Cancel \u2014 add a new pin here anyway`
      );

    if(openExisting){
      openEditor(duplicate.id);
      return;
    }

  }



  pendingSite = {


    ...createEmptySite(),



    name,



    city:
      address.city ||
      address.town ||
      address.village ||
      address.municipality ||
      "",



    country:
      address.country ||
      "",



    lat,



    lng


  };



  editingSiteId=null;


  populateEditor();

  editorModal.hidden=false;

  const searchCard =
    editorModal.querySelector(".panel-card");

  if(searchCard)
    searchCard.scrollTop = 0;



  const wiki =
    await fetchWikipediaSummary(
      pendingSite.name,
      pendingSite.city
    );



  if(!pendingSite)
    return;



  pendingSite.abstract =
    firstSentence(
      wiki.extract || ""
    );



  pendingSite.imageUrl =
    wiki.imageUrl || "";



  // Always empty after enrichment
  pendingSite.selectedStops=[];



  populateEditor();


}







/* =========================================================
   Wikipedia
   ========================================================= */


async function fetchWikipediaSummary(name,city){

  try{

    const query =
      [name,city]
      .filter(Boolean)
      .join(" ");



    const search =
      await fetch(
        `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*&srlimit=5`
      );



    const data =
      await search.json();



    const titles =
      data.query?.search
      ?.map(item => item.title)
      || [];



    for(const title of titles){


      const summary =
        await fetchWikipediaTitle(title);



      if(
        summary?.extract &&
        title.toLowerCase()
        .includes(
          name.toLowerCase()
        )
      ){

        return summary;

      }

    }



    for(const title of titles){

      const summary =
        await fetchWikipediaTitle(title);



      if(summary?.extract)
        return summary;

    }


  }
  catch{

    return {};

  }


  return {};

}





async function fetchWikipediaTitle(title){

  try{

    const response =
      await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`
      );



    if(!response.ok)
      return {};



    const data =
      await response.json();



    return {

      extract:
        data.extract || "",


      imageUrl:
        data.thumbnail?.source ||
        data.originalimage?.source ||
        ""

    };


  }
  catch{

    return {};

  }

}







/* =========================================================
   Image positioning
   ========================================================= */


function makeImageDraggable(img){

  let dragging = false;
  let startX = 0;
  let startY = 0;

  let startPosX = 50;
  let startPosY = 50;


  function getPosition(){

    const pos =
      pendingSite?.imagePosition ||
      "50% 50%";

    return pos
      .split(" ")
      .map(
        value => parseFloat(value)
      );

  }



  function start(e){

    if(!pendingSite)
      return;


    dragging = true;

    img.classList.add("dragging");

    const point =
      e.touches
      ? e.touches[0]
      : e;


    startX = point.clientX;
    startY = point.clientY;


    [
      startPosX,
      startPosY
    ] = getPosition();


    img.setPointerCapture?.(
      e.pointerId
    );


    e.preventDefault();

  }



  function move(e){

    if(!dragging)
      return;


    const point =
      e.touches
      ? e.touches[0]
      : e;


    const rect =
      img.getBoundingClientRect();


    const x =
      clamp(
        startPosX -
        ((point.clientX - startX) / rect.width) * 100,
        0,
        100
      );


    const y =
      clamp(
        startPosY -
        ((point.clientY - startY) / rect.height) * 100,
        0,
        100
      );


    pendingSite.imagePosition =
      `${x}% ${y}%`;


    img.style.objectPosition =
      pendingSite.imagePosition;

  }



  function end(){

    dragging = false;

    img.classList.remove(
      "dragging"
    );

  }


  img.style.touchAction = "none";


  img.addEventListener(
    "pointerdown",
    start
  );


  img.addEventListener(
    "pointermove",
    move
  );


  img.addEventListener(
    "pointerup",
    end
  );


  img.addEventListener(
    "pointercancel",
    end
  );

}


makeImageDraggable(editorImage);







/* =========================================================
   Import / Export
   ========================================================= */


document
.getElementById("export-btn")
?.addEventListener(
"click",
()=>{


const blob =
new Blob(
[
JSON.stringify(
sites,
null,
2
)
],
{
type:"application/json"
}
);



const url =
URL.createObjectURL(blob);



const link =
document.createElement("a");



link.href=url;

link.download =
`atlas-sites-${todayISO()}.json`;



link.click();


URL.revokeObjectURL(url);


});





const importInput =
document.getElementById(
"import-file"
);



document
.getElementById("import-btn")
?.addEventListener(
"click",
()=>importInput.click()
);




importInput
?.addEventListener(
"change",
async ()=>{


const file =
importInput.files[0];


if(!file)
return;



try{


const imported =
JSON.parse(
await file.text()
);



if(!Array.isArray(imported))
throw new Error();



sites =
imported.map(
normalizeSite
);



saveSites();

renderPins();


}
catch{

alert(
"Unable to import Atlas file."
);

}


importInput.value="";


});







/* =========================================================
   Helpers
   ========================================================= */


function todayISO(){

return new Date()
.toISOString()
.slice(0,10);

}




function firstSentence(text){

if(!text)
return "";

return text
.replace(/\s+/g," ")
.split(/(?<=[.!?])\s+/)[0]
.trim();

}





function clamp(value,min,max){

return Math.min(
max,
Math.max(
min,
value
)
);

}





function escapeHtml(str){

return String(str)
.replace(
/[&<>"']/g,
char =>
({
"&":"&amp;",
"<":"&lt;",
">":"&gt;",
'"':"&quot;",
"'":"&#39;"
})[char]
);

}






function placeholderImage(){

return (
"data:image/svg+xml;utf8," +
encodeURIComponent(
`
<svg xmlns="http://www.w3.org/2000/svg"
width="400"
height="220">

<rect width="100%"
height="100%"
fill="#e6d8b8"/>

<text
x="50%"
y="50%"
text-anchor="middle"
font-family="Georgia"
font-size="16"
fill="#2b1b12">

No image yet

</text>

</svg>
`
)
);

}







/* =========================================================
   Init
   ========================================================= */

document
  .getElementById("legend-icon-visited")
  .innerHTML =
    pinHtml(
      "visited",
      22
    );

loadSites().then(loaded => {
  sites = loaded;
  renderPins();
});