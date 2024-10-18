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

function haversineDistance(lat1, lon1, lat2, lon2) {
    var R = 6371 * 1000; // m
    var dLat = toRad(lat2-lat1);
    var dLon = toRad(lon2-lon1);
    var lat1 = toRad(lat1);
    var lat2 = toRad(lat2);

    var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.sin(dLon/2) * Math.sin(dLon/2) * Math.cos(lat1) * Math.cos(lat2); 
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
    var d = R * c;
    return d;
}

// Converts numeric degrees to radians
function toRad(Value) 
{
    return Value * Math.PI / 180;
}

let cy; // Cytoscape instance

let detruits = 0;

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

function initGraph() {
    // Clear previous data
    cy.elements().remove();

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
        // Remove the node from Cytoscape
        cyNode.remove(); // Ensure the node is removed

        detruits = detruits + 1 ;
    }

    // Update point types after removal
    updatePointTypes();
}

function findAllPointsWithinRadius(lat, lng, radiusInMeters) {
    const geohashesWithinRadius = [];

    cy.nodes().forEach(node => {
        // dont ping sources
        if (node.data('type') !== 'source') {
            const pointLatLng = decodeGeoHash(node.id()); // Use node ID for geohash

            const distance = haversineDistance(lat, lng, pointLatLng[0], pointLatLng[1]); // Distance in meters

            // Only add to the array if within radius
            if (distance <= radiusInMeters) {
                geohashesWithinRadius.push(node.id()); // Use node ID (geohash)
            }
        }
    });

    return geohashesWithinRadius;
}

function findPointsWithinRadius(lat, lng, radiusInMeters) {
    let closestPoint = null;
    let minDistance = Infinity;

    cy.nodes().forEach(node => {
        // Exclude nodes of type 'source'
        if (node.data('type') !== 'source') {
            // Decode the geohash from the node ID to get [latitude, longitude]
            const pointLatLng = decodeGeoHash(node.id());

            // Calculate the distance using the haversine formula
            const distance = haversineDistance(lat, lng, pointLatLng[0], pointLatLng[1]); // Distance in meters

            // Check if the point is within the specified radius and closer than the current minimum
            if (distance <= radiusInMeters && distance < minDistance) {
                minDistance = distance;
                closestPoint = node.id(); // Store the geohash of the closest point
            }
        }
    });

    // Return an array with the closest point's geohash, or an empty array if none found
    return closestPoint ? [closestPoint] : [];
}


// Initialize Cytoscape
initializeCytoscape();
initGraph();

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
    initGraph();
}

// 42.61602288076517 8.91368865966797
function clickEvent(lat, lon) {
    const radius = 1000; // 1km
    const nearbyGeohashes = findPointsWithinRadius(lat, lon, radius);
//    console.log("destroy",lat,lon);
    for (let geohash of nearbyGeohashes) {
        removePoint(geohash);
    }

}

function printCost() {
    const pylonsPerKm = 2
    const pylonCostPerKm = 288000
    const pylonCost = pylonCostPerKm / pylonsPerKm
    var returnMessage = detruits + " KO: " + Math.round(pylonCost * detruits*0.001) + "KEuros ";

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
    return returnMessage + disconnectedCount + " OFF :" + Math.round(costPerPylon * (disconnectedCount +detruits) * 0.001) + "KEuros/h";
}
