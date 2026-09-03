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

// Wikipedia enrichment happens asynchronously after the modal is already
// open and interactive. These track whether the user has started editing
// a field themselves in that window, so the fetch result never silently
// overwrites something they've already typed.
let userEditedAbstract = false;
let userEditedStops = false;
let userUploadedImage = false;

// Legend acts as a filter: unchecking a status hides those pins from the map.
const visibleStatuses = {
  visited:true,
  wantToVisit:true
};

let currentView = "map"; // "map" | "list"

function refreshView(){
  if(currentView === "list"){
    renderListView();
  }
  else{
    renderPins();
  }
}





/* =========================================================
   Map
   ========================================================= */


const map = L.map("map", {
  worldCopyJump:true,
  zoomControl:false
}).setView([30,10],2.5);


L.control.zoom({ position:"bottomleft" }).addTo(map);


const mapLegendEl =
  document.getElementById("map-legend");

mapLegendEl.querySelectorAll(".legend-item").forEach(btn => {

  btn.addEventListener("click", () => {

    const status = btn.dataset.status;
    visibleStatuses[status] = !visibleStatuses[status];

    btn.classList.toggle(
      "legend-item-inactive",
      !visibleStatuses[status]
    );

    refreshView();

  });

});



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


// Prefer opening the tooltip/card above the pin (matches the old behavior).
// Only fall back to another side if "top" would actually be clipped by
// the map's own edge on that side.
function pickCardDirection(lat, lng, estimatedWidth, estimatedHeight){

  const pt =
    map.latLngToContainerPoint([lat, lng]);

  const size =
    map.getSize();


  const spaceAbove = pt.y;
  const spaceBelow = size.y - pt.y;
  const spaceLeft = pt.x;
  const spaceRight = size.x - pt.x;


  // "top" and "bottom" center the card horizontally on the marker, so
  // they need clearance on BOTH sides, not just vertical room.
  const halfWidth = estimatedWidth / 2;
  const fitsCenteredHorizontally =
    spaceLeft >= halfWidth && spaceRight >= halfWidth;


  if(spaceAbove >= estimatedHeight && fitsCenteredHorizontally)
    return "top";

  if(spaceBelow >= estimatedHeight && fitsCenteredHorizontally)
    return "bottom";

  if(spaceRight >= estimatedWidth)
    return "right";

  if(spaceLeft >= estimatedWidth)
    return "left";


  // Nothing fits cleanly — prefer whichever vertical side has more room.
  return spaceAbove >= spaceBelow ? "top" : "bottom";

}



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
          direction:
            pickCardDirection(site.lat, site.lng, 360, 220),
          sticky:false,
          offset:[0,-8]
        }
      );

      marker.on(
        "click",
        () => {
          marker.closeTooltip();
          openEditor(site.id);
        }
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
      group.map(g => `<li>${escapeHtml(g.site.name)}</li>`).join("");

    const estimatedHeight = 60 + group.length * 32;
    const estimatedWidth = 260;

    marker.bindTooltip(
      `
      <p class="tooltip-name">${group.length} pins here</p>
      <ul class="tooltip-list">${names}</ul>
      `,
      {
        direction:
          pickCardDirection(avgLat, avgLng, estimatedWidth, estimatedHeight),
        sticky:false,
        className:"cluster-tooltip",
        offset:[0,-8]
      }
    );

    marker.on(
      "click",
      () => {

        // Hover state and click state shouldn't coexist — the tooltip
        // has done its job once the popup takes over.
        marker.closeTooltip();

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

        L.popup({
          closeButton:true,
          maxWidth:260,
          minWidth:220,
          autoPan:true,
          autoPanPadding:[60,60],
          autoPanPaddingTopLeft:[60,150]
        })
          .setLatLng([avgLat, avgLng])
          .setContent(container)
          .openOn(map);

      }
    );

    marker.addTo(markerLayer);

  });

}




/* =========================================================
   List view
   ========================================================= */


const mapEl =
  document.getElementById("map");

const listViewEl =
  document.getElementById("list-view");

const listViewContent =
  document.getElementById("list-view-content");

const listFilterInput =
  document.getElementById("list-filter-input");

const viewToggleBtn =
  document.getElementById("view-toggle-btn");


let listFilterQuery = "";


function renderListView(){

  if(!listViewContent)
    return;


  const query =
    listFilterQuery.trim().toLowerCase();


  const visibleSites =
    sites.filter(site => {

      if(!visibleStatuses[site.status])
        return false;

      if(!query)
        return true;

      return (
        site.name.toLowerCase().includes(query) ||
        (site.city || "").toLowerCase().includes(query)
      );

    });


  if(visibleSites.length === 0){

    listViewContent.innerHTML =
      query
      ? `<p class="list-empty-state">No pins match "${escapeHtml(listFilterQuery.trim())}".</p>`
      : `<p class="list-empty-state">No sites match the current filters.</p>`;

    return;

  }


  const byCountry = {};

  visibleSites.forEach(site => {

    const country =
      site.country || "Unknown";

    if(!byCountry[country])
      byCountry[country] = [];

    byCountry[country].push(site);

  });


  const countries =
    Object.keys(byCountry)
      .sort((a,b) => a.localeCompare(b));


  listViewContent.innerHTML = "";


  countries.forEach(country => {

    const heading =
      document.createElement("h2");

    heading.className =
      "list-country-heading";

    heading.textContent = country;

    listViewContent.appendChild(heading);


    const sortedSites =
      [...byCountry[country]]
        .sort((a,b) => a.name.localeCompare(b.name));


    sortedSites.forEach(site => {

      const item =
        document.createElement("button");

      item.type = "button";
      item.className = "list-site-item";

      const icon =
        document.createElement("span");
      icon.className = "list-site-icon";
      icon.innerHTML = pinHtml(site.status, 22, 1);

      const name =
        document.createElement("span");
      name.className = "list-site-name";
      name.textContent = site.name;

      const city =
        document.createElement("span");
      city.className = "list-site-city";
      city.textContent = site.city || "";

      item.appendChild(icon);
      item.appendChild(name);
      item.appendChild(city);

      item.addEventListener(
        "click",
        () => openEditor(site.id)
      );

      listViewContent.appendChild(item);

    });

  });

}


listFilterInput?.addEventListener("input", () => {

  listFilterQuery = listFilterInput.value;

  if(currentView === "list")
    renderListView();

});


viewToggleBtn?.addEventListener("click", () => {

  if(currentView === "map"){

    currentView = "list";
    mapEl.hidden = true;
    listViewEl.hidden = false;
    viewToggleBtn.textContent = "Map View";
    renderListView();

  }
  else{

    currentView = "map";
    mapEl.hidden = false;
    listViewEl.hidden = true;
    viewToggleBtn.textContent = "List View";
    renderPins();

    // Leaflet needs to recompute its size after being hidden/shown.
    setTimeout(() => map.invalidateSize(), 0);

  }

});






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


  userEditedAbstract = false;
  userEditedStops = false;
  userUploadedImage = false;



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





// Applies Wikipedia enrichment results (called after an async fetch, once
// the editor is already open) without disrupting anything the user has
// started editing in the meantime — unlike populateEditor(), this never
// forces a field out of active edit mode or overwrites a touched value.
function applyWikipediaEnrichment(wiki){

  if(!pendingSite)
    return;


  if(!userEditedAbstract){

    pendingSite.abstract =
      firstSentence(wiki.extract || "");

    if(editorAbstract.hidden)
      renderAbstractDisplay();

  }


  if(!userUploadedImage){

    pendingSite.imageUrl =
      wiki.imageUrl || "";

    editorImage.src =
      pendingSite.imageUrl ||
      placeholderImage();

    editorImage.style.objectPosition =
      pendingSite.imagePosition;

  }


  if(!userEditedStops && editorStops.hidden){

    renderStopsDisplay();

  }

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


  // Always start blank — otherwise a date typed but not logged (modal
  // closed without clicking Log Visit) would linger into the next open.
  if(logVisitDateInput)
    logVisitDateInput.value = "";


  // No pin exists yet for a site that hasn't been saved for the first time.
  const deleteBtn =
    document.getElementById("delete-pin-btn");

  if(deleteBtn)
    deleteBtn.hidden = !editingSiteId;

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

  userEditedAbstract = true;

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

  userEditedStops = true;

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

  refreshView();

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






/* =========================================================
   Themed confirm/alert dialog (replaces native confirm()/alert())
   ========================================================= */


const confirmDialog =
  document.getElementById("confirm-dialog");

const confirmDialogMessage =
  document.getElementById("confirm-dialog-message");

const confirmDialogCancelBtn =
  document.getElementById("confirm-dialog-cancel");

const confirmDialogOkBtn =
  document.getElementById("confirm-dialog-ok");


// Returns a Promise<boolean> — true if confirmed/acknowledged, false if
// cancelled. Pass cancelText:null for a single-button "alert" style.
function showDialog({
  message,
  confirmText = "OK",
  cancelText = "Cancel",
  danger = false
}){

  return new Promise(resolve => {

    confirmDialogMessage.textContent = message;

    confirmDialogOkBtn.textContent = confirmText;
    confirmDialogOkBtn.classList.toggle("danger-btn", danger);

    confirmDialogCancelBtn.hidden = !cancelText;
    if(cancelText)
      confirmDialogCancelBtn.textContent = cancelText;

    confirmDialog.hidden = false;
    confirmDialogOkBtn.focus();


    function cleanup(result){
      confirmDialog.hidden = true;
      confirmDialogOkBtn.removeEventListener("click", onOk);
      confirmDialogCancelBtn.removeEventListener("click", onCancel);
      confirmDialog.removeEventListener("click", onBackdrop);
      document.removeEventListener("keydown", onKeydown, true);
      resolve(result);
    }

    function onOk(){ cleanup(true); }
    function onCancel(){ cleanup(false); }

    function onBackdrop(e){
      if(e.target === confirmDialog) cleanup(false);
    }

    function onKeydown(e){
      if(e.key === "Escape"){
        e.stopPropagation();
        cleanup(false);
      }
      if(e.key === "Enter"){
        e.stopPropagation();
        cleanup(true);
      }
    }

    confirmDialogOkBtn.addEventListener("click", onOk);
    confirmDialogCancelBtn.addEventListener("click", onCancel);
    confirmDialog.addEventListener("click", onBackdrop);
    // Capture phase so this runs before the editor modal's own
    // document-level Escape handler.
    document.addEventListener("keydown", onKeydown, true);

  });

}


function showConfirm(message, opts = {}){
  return showDialog({ message, ...opts });
}


function showAlert(message){
  return showDialog({ message, cancelText: null });
}



function dismissEditor(){

  if(pendingSite){
    saveEditor(); // saves and closes
  }
  else{
    closeEditor();
  }

}


editorModal.addEventListener(
  "click",
  e => {

    if(e.target === editorModal){
      dismissEditor();
    }

  }
);





document.addEventListener(
  "keydown",
  e => {

    if(
      e.key === "Escape" &&
      !editorModal.hidden &&
      confirmDialog.hidden
    ){

      dismissEditor();

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
    async () => {


      if(!editingSiteId)
        return;



      const confirmed =
        await showConfirm(
          "Remove this pin? This can't be undone.",
          { confirmText:"Remove", danger:true }
        );

      if(!confirmed)
        return;



      sites =
        sites.filter(
          site =>
          site.id !== editingSiteId
        );



      saveSites();

      refreshView();

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


        userUploadedImage = true;

        pendingSite.imageUrl =
          reader.result;


        editorImage.src =
          reader.result;


      };



    reader.readAsDataURL(file);


  }
);







/* =========================================================
   Search - FIXED for museum complexes like Musei Reali Torino
   - Wikipedia entity-first (like Google)
   - Photon for tourism=museum ranking
   - Nominatim fallback with IT bias + re-ranking
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



document.addEventListener("click", e => {

  if(searchResults.hidden)
    return;

  if(!searchForm.contains(e.target))
    searchResults.hidden = true;

});


document.addEventListener("keydown", e => {

  if(e.key === "Escape" && !searchResults.hidden){
    searchResults.hidden = true;
    searchInput.blur();
  }

});




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


      const results = await smartGeocode(query);

      renderSearchResults(results);


    }
    catch(err){
      console.error(err);
      searchResults.innerHTML =
        "<button disabled>Search failed — try Italian name</button>";

    }


  }
);



// Smart geocoder that fixes Musei Reali Torino
async function smartGeocode(query){
  // Stage 1: Wikipedia/Wikidata entity search (Google-style)
  // This solves "Musei Reali di Torino" which is a museum SITE, not a single OSM node
  try {
    const wikiSearchRes = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*&srlimit=3`
    );
    const wikiSearch = await wikiSearchRes.json();
    const bestTitle = wikiSearch.query?.search?.[0]?.title;

    if(bestTitle){
      const geoRes = await fetch(
        `https://en.wikipedia.org/w/api.php?action=query&prop=coordinates&titles=${encodeURIComponent(bestTitle)}&format=json&origin=*`
      );
      const geo = await geoRes.json();
      const pages = Object.values(geo.query.pages || {});
      const coords = pages[0]?.coordinates?.[0];
      if(coords){
        // We have a Wikipedia entity with coordinates - return it as top result
        return [{
          display_name: `${bestTitle} — from Wikipedia`,
          lat: coords.lat.toString(),
          lon: coords.lon.toString(),
          importance: 1.5,
          type: 'museum',
          isWikipedia: true,
          address: {}
        }];
      }
    }
  } catch(err){
    console.warn('Wikipedia geocode stage failed', err);
  }

  // Stage 2: Photon (komoot) - much better for tourism=museum, historic, etc.
  try {
    const photonRes = await fetch(
      `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=10&lang=it&lat=45.0703&lon=7.6869`
    );
    const photon = await photonRes.json();
    if(photon.features && photon.features.length){
      const mapped = photon.features.map(f => ({
        display_name: [f.properties.name, f.properties.street, f.properties.city, f.properties.country].filter(Boolean).join(', '),
        lat: f.geometry.coordinates[1].toString(),
        lon: f.geometry.coordinates[0].toString(),
        importance: f.properties.osm_type === 'R' ? 0.3 : 0,
        type: f.properties.osm_value || '',
        osm_key: f.properties.osm_key || '',
        osm_value: f.properties.osm_value || '',
        extratags: { tourism: f.properties.osm_key === 'tourism' ? f.properties.osm_value : undefined },
        address: { city: f.properties.city, country: f.properties.country },
        _rawImportance: 0
      }));

      // Re-rank: boost museums, historic sites
      const ranked = mapped
        .map(r => {
          let score = r.importance || 0;
          if(r.osm_value === 'museum' || r.type === 'museum') score += 1.0;
          if(r.osm_key === 'tourism') score += 0.6;
          if(r.osm_key === 'historic') score += 0.4;
          return { ...r, _score: score };
        })
        .sort((a,b) => b._score - a._score);

      // If we have a strong museum hit, return it
      if(ranked[0]._score > 0.5) return ranked.slice(0,6);
    }
  } catch(err){
    console.warn('Photon stage failed', err);
  }

  // Stage 3: Nominatim fallback with IT bias and proper extratags
  const response =
    await fetch(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&namedetails=1&extratags=1&limit=10&countrycodes=it&accept-language=it&q=${encodeURIComponent(query)}`
    );

  const results =
    await response.json();

  // Final re-ranking to fix Venaria vs Torino bug
  return results
    .map(r => {
      let score = r.importance || 0;
      if(r.extratags?.tourism === 'museum') score += 0.8;
      if(r.extratags?.historic) score += 0.4;
      if(r.type === 'tourism' || r.type === 'historic') score += 0.3;
      // Penalize Venaria Reale when query explicitly says Torino
      if(query.toLowerCase().includes('torino') && r.display_name.toLowerCase().includes('venaria')) score -= 0.7;
      // Boost if display_name contains Torino for Torino queries
      if(query.toLowerCase().includes('torino') && r.display_name.toLowerCase().includes('torino')) score += 0.2;
      return { ...r, _score: score };
    })
    .sort((a,b) => b._score - a._score)
    .slice(0,6);
}


function renderSearchResults(results){

  searchResults.innerHTML="";


  if(!results.length){

    searchResults.innerHTML =
      "<button disabled>No results — try the Italian name, e.g. 'Palazzo Reale Torino'</button>";

    return;

  }



  results.forEach(result => {


    const button =
      document.createElement(
        "button"
      );

    button.className = "search-result-btn";
    const isMuseum = result.type === 'museum' || result.osm_key === 'tourism' || result.extratags?.tourism === 'museum' || result.isWikipedia;
    const name = result.display_name.split(',')[0];
    button.innerHTML = `<span class="result-name">${escapeHtml(name)} ${isMuseum ? '🏛️' : ''}</span><span class="result-sub">${escapeHtml(result.display_name)}</span>`;


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


  // Use the name the user actually saw and clicked in the dropdown —
  // not OSM's local-language name tag, which can silently differ (e.g.
  // "Colosseo" vs "Colosseum") and send the Wikipedia search down the
  // wrong path entirely.
  const name =
    result.display_name.split(",")[0];


  const lat =
    Number(result.lat);


  const lng =
    Number(result.lon);



  const duplicate =
    findPossibleDuplicate(name, lat, lng);


  if(duplicate){

    const openExisting =
      await showConfirm(
        `You already have a pin for "${duplicate.name}" near here.`,
        {
          confirmText:"Open Existing Pin",
          cancelText:"Add New Pin Anyway"
        }
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

  userEditedAbstract = false;
  userEditedStops = false;
  userUploadedImage = false;


  populateEditor();

  editorModal.hidden=false;

  const searchCard =
    editorModal.querySelector(".panel-card");

  if(searchCard)
    searchCard.scrollTop = 0;


  // Visible signal that something is still loading, so the blank
  // placeholder doesn't get mistaken for "nothing found."
  if(!userEditedAbstract && editorAbstract.hidden){
    editorAbstractDisplay.textContent = "Fetching details from Wikipedia\u2026";
    editorAbstractDisplay.classList.add("placeholder-text");
  }


  const wiki =
    await fetchWikipediaSummary(
      pendingSite.name,
      pendingSite.city,
      pendingSite.lat,
      pendingSite.lng
    );



  if(!pendingSite)
    return;



  applyWikipediaEnrichment(wiki);

}







/* =========================================================
   Wikipedia
   ========================================================= */


// Reject a Wikipedia match only if it's implausibly far from where the
// site was actually geocoded to — no category exclusions, since a
// transit hub can itself be exactly what someone means to add (e.g.
// Grand Central Station).
function haversineKm(lat1,lng1,lat2,lng2){

  const R = 6371;
  const dLat = (lat2-lat1) * Math.PI/180;
  const dLng = (lng2-lng1) * Math.PI/180;

  const a =
    Math.sin(dLat/2)**2 +
    Math.cos(lat1*Math.PI/180) *
    Math.cos(lat2*Math.PI/180) *
    Math.sin(dLng/2)**2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

}

function isLikelyWrongMatch(summary, targetLat, targetLng){

  if(
    summary.coordinates &&
    targetLat != null &&
    targetLng != null
  ){

    const distanceKm =
      haversineKm(
        summary.coordinates.lat,
        summary.coordinates.lon,
        targetLat,
        targetLng
      );

    if(distanceKm > 5)
      return true;

  }


  return false;

}


async function fetchWikipediaSummary(name,city,lat,lng){

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
        ) &&
        !isLikelyWrongMatch(summary, lat, lng)
      ){

        return summary;

      }

    }



    for(const title of titles){

      const summary =
        await fetchWikipediaTitle(title);


      if(
        summary?.extract &&
        !isLikelyWrongMatch(summary, lat, lng)
      ){
        return summary;
      }

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


      description:
        data.description || "",


      type:
        data.type || "",


      coordinates:
        data.coordinates || null,


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

refreshView();


}
catch{

await showAlert(
"Unable to import Atlas file. Make sure it's a JSON file exported from Atlas."
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




const SENTENCE_ABBREVIATIONS = new Set([
  "st","mt","dr","mr","mrs","ms","jr","sr","vs","etc",
  "no","ave","blvd","ft","ste","rev","prof","gen","col",
  "capt","sgt","co","corp","inc","ltd","e.g","i.e"
]);

function endsWithAbbreviation(fragment){

  const match =
    fragment.match(/([A-Za-z]+)\.$/);

  if(!match)
    return false;

  return SENTENCE_ABBREVIATIONS.has(
    match[1].toLowerCase()
  );

}


function firstSentence(text){

if(!text)
return "";

const parts =
  text
  .replace(/\s+/g," ")
  .trim()
  .split(/(?<=[.!?])\s+/);

let result = parts[0] || "";
let i = 1;

// Keep merging fragments if the "sentence" so far actually ended on
// an abbreviation (e.g. "St.") rather than a real sentence boundary.
while(i < parts.length && endsWithAbbreviation(result)){
  result += " " + parts[i];
  i++;
}

return result.trim();

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
  refreshView();
});