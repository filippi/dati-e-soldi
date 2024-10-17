var GeoHash = (function () {
    BITS = [16, 8, 4, 2, 1];
    BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";
    NEIGHBORS = {
        right: { even: "bc01fg45238967deuvhjyznpkmstqrwx" },
        left: { even: "238967debc01fg45kmstqrwxuvhjyznp" },
        top: { even: "p0r21436x8zb9dcf5h7kjnmqesgutwvy" },
        bottom: { even: "14365h7k9dcfesgujnmqp0r2twvyx8zb" }
    };
    BORDERS = {
        right: { even: "bcfguvyz" },
        left: { even: "0145hjnp" },
        top: { even: "prxz" },
        bottom: { even: "028b" }
    };
    NEIGHBORS.bottom.odd = NEIGHBORS.left.even;
    NEIGHBORS.top.odd = NEIGHBORS.right.even;
    NEIGHBORS.left.odd = NEIGHBORS.bottom.even;
    NEIGHBORS.right.odd = NEIGHBORS.top.even;
    BORDERS.bottom.odd = BORDERS.left.even;
    BORDERS.top.odd = BORDERS.right.even;
    BORDERS.left.odd = BORDERS.bottom.even;
    BORDERS.right.odd = BORDERS.top.even;
    var refine_interval = function (interval, cd, mask) {
        if (cd & mask)
            interval[0] = (interval[0] + interval[1]) / 2;
        else
            interval[1] = (interval[0] + interval[1]) / 2;
    };
    return {
        decodeGeoHash: function (geohash) {
            var is_even = 1;
            var lat = []; var lon = [];
            lat[0] = -90.0; lat[1] = 90.0;
            lon[0] = -180.0; lon[1] = 180.0;
            lat_err = 90.0; lon_err = 180.0;
            for (i = 0; i < geohash.length; i++) {
                c = geohash[i];
                cd = BASE32.indexOf(c);
                for (j = 0; j < 5; j++) {
                    mask = BITS[j];
                    if (is_even) {
                        lon_err /= 2;
                        refine_interval(lon, cd, mask);
                    } else {
                        lat_err /= 2;
                        refine_interval(lat, cd, mask);
                    }
                    is_even = !is_even;
                }
            }
            lat[2] = (lat[0] + lat[1]) / 2;
            lon[2] = (lon[0] + lon[1]) / 2;
            return { latitude: lat, longitude: lon };
        }
    };
})();

function decodeGeoHash(geohash) {
    const result = GeoHash.decodeGeoHash(geohash);
    return [result.latitude[2], result.longitude[2]]; // Accessing the middle value (index 2)
}

let cy; // Cytoscape instance

let detruits = 0;

// Initialize the map
const map = L.map('map').setView([0, 0], 2);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
}).addTo(map);

let bounds = L.latLngBounds(); // Create a LatLngBounds object

const scriptElement = document.getElementById('data-script');

// Get the data attributes
const edgesPath = scriptElement.getAttribute('data-edges-path');
const nodesPath = scriptElement.getAttribute('data-nodes-path');

// Initialize Cytoscape
function initializeCytoscape() {
    cy = cytoscape({
        //container: document.getElementById('cy'), // This should be a div for Cytoscape visualization (optional)
        elements: [],
    });
}

function initGraph(fitBounds) {
    // Clear previous data
    cy.elements().remove();
    map.eachLayer(layer => {
        if (layer instanceof L.CircleMarker) {
            map.removeLayer(layer);
        }
    });

    // Fetch edges
    fetch(edgesPath)
        .then(response => {
            if (!response.ok) {
                throw new Error('Network response was not ok ' + response.statusText);
            }
            return response.json(); // Parse JSON
        })
        .then(edgesJson => {
            // Convert edges data
            const edges = edgesJson.data.map(row => ({
                data: {
                    id: `${row[0]}-${row[1]}`, // Unique edge ID
                    source: row[0],
                    target: row[1]
                }
            }));

            // Fetch nodes
            return fetch(nodesPath)
                .then(response => {
                    if (!response.ok) {
                        throw new Error('Network response was not ok ' + response.statusText);
                    }
                    return response.json();
                })
                .then(pointsJson => {
                    // Convert nodes data
                    const nodes = pointsJson.data.map(row => ({
                        data: {
                            id: row[0], // Unique node ID
                            type: row[1]
                        }
                    }));

                    // total node count
                    totalNodeCount = nodes.length;

                    // Add nodes and edges to Cytoscape
                    cy.add(nodes);
                    cy.add(edges);

                    // Create Leaflet markers
                    pointsJson.data.forEach(row => {
                        const [lat, lng] = decodeGeoHash(row[0]);

                        // Set marker properties based on node type
                        const fillColor = row[1] === "source" ? "orange" : "green"; // Color for source nodes
                        const radius = row[1] === "source" ? 4 : 2; // Bigger radius for source nodes

                        // Create Leaflet marker
                        const marker = L.circleMarker([lat, lng], {
                            radius: radius,
                            fillColor: fillColor,
                            color: fillColor,
                            weight: 1,
                            opacity: 1,
                            fillOpacity: 1
                        }).addTo(map);

                        // Store a reference to the marker in Cytoscape's data
                        cy.getElementById(row[0]).data('marker', marker);

                        // Extend bounds to include this marker's position
                        bounds.extend([lat, lng]);
                    });

                    if (fitBounds) {
                        map.fitBounds(bounds);
                    }
                });
        })
        .catch(error => console.error('Error fetching data:', error));
}

function updatePointTypes() {
    // Get all connected components
    const components = cy.elements().components();

    // Iterate through each component
    components.forEach(component => {
        // Check if the component contains a source node
        const hasSource = component.some(node => node.data('type') === 'source');

        if (!hasSource) {
            // If no source node, mark all nodes in this component as disconnected
            component.forEach(node => {
                if (node.data('type') === 'pylone') {
                    node.data('type', 'disconnected');
                    const marker = node.data('marker');
                    if (marker) {
                        marker.setStyle({ 
                            fillColor: "red", 
                            color: "red"
                        });
                    }
                }
            });
        }
    });
}

function removePoint(geohash) {
    // Find the point by geohash in Cytoscape
    const cyNode = cy.getElementById(geohash);
    
    if (cyNode) {
        // Remove the corresponding Leaflet marker
        const marker = cyNode.data('marker');
        if (marker) {
            map.removeLayer(marker); // Remove marker from Leaflet map
        }

        // Remove the node from Cytoscape
        cyNode.remove(); // Ensure the node is removed

        detruits = detruits + 1 ;
    }

    // Update point types after removal
    updatePointTypes();
}

function findPointsWithinRadius(lat, lng, radiusInMeters) {
    const clickedLatLng = L.latLng(lat, lng);
    const geohashesWithinRadius = [];

    cy.nodes().forEach(node => {
        // dont ping sources
        if (node.data('type') !== 'source') {
            const pointLatLng = decodeGeoHash(node.id()); // Use node ID for geohash
            const pointLatLngLeaflet = L.latLng(pointLatLng[0], pointLatLng[1]);

            const distance = map.distance(clickedLatLng, pointLatLngLeaflet); // Distance in meters

            // Only add to the array if within radius
            if (distance <= radiusInMeters) {
                geohashesWithinRadius.push(node.id()); // Use node ID (geohash)
            }
        }
    });

    return geohashesWithinRadius;
}

// Add a click event to the map to find nearby points
map.on('click', function(e) {
    const radius = 1000;
    const nearbyGeohashes = findPointsWithinRadius(e.latlng.lat, e.latlng.lng, radius);

    for (let geohash of nearbyGeohashes) {
        removePoint(geohash);
    }
}); 

// Initialize Cytoscape
initializeCytoscape();
initGraph(true);

//////////////
// wrappers //
//////////////

function getAllNodesWithTypes() {
    const nodesWithTypes = [];

    cy.nodes().forEach(node => {
        let typeValue;

        switch (node.data('type')) {
            case 'source':
                typeValue = 0; // Source
                break;
            case 'disconnected':
                typeValue = 1; // Disconnected
                break;
            case 'pylone':
                typeValue = 2; // Pylone
                break;
            default:
                typeValue = null; // Or handle other types if necessary
        }

        nodesWithTypes.push({
            id: node.id(),
            type: typeValue
        });
    });

    return nodesWithTypes;
}

function reinit() {
    initGraph(false);
}

function clickEvent(lat, lon) {
    const radius = 1000; // 1km
    const nearbyGeohashes = findPointsWithinRadius(lat, lon, radius);

    for (let geohash of nearbyGeohashes) {
        removePoint(geohash);
    }
}

function printCost() {
    const pylonsPerKm = 2
    const pylonCostPerKm = 288000
    const pylonCost = pylonCostPerKm / pylonsPerKm
    console.log(detruits + " poteaux détruits : " + pylonCost * detruits + " € de coûts de réparation");

    const lineLength = 710 ; // km
    const surfaceCorsica = 8680; // km²
    const pylonsPerKm2 = (lineLength * pylonsPerKm) / surfaceCorsica; // pylones / km²
    const populationDensity = 40; // hab / km²
    const populationPerHousehold = 2;
    const householdsPerPylon = (populationDensity / populationPerHousehold) / pylonsPerKm2;
    const costPerHour = 24; // €
    const costPerPylon = householdsPerPylon * costPerHour;
    // cout par pylone = nombre de maisons couvertes par 1 pylone * cout par heure
    // pylones par km²
    let disconnectedCount = 0;
    cy.nodes().forEach(node => {
        if (node.data('type') === 'disconnected') {
            disconnectedCount++;
        }
    });
    console.log(disconnectedCount + " poteaux déconnectés : " + costPerPylon * disconnectedCount + " €/heure d'interruption de service");
}
