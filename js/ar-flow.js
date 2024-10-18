const NETWORK = 0; 
const LAGRANGIAN = 1; 
const FIRECASTER = 2; 
const RAIN = 3;
const firecasterAPI = 'https://forefire.univ-corse.fr/twin/simapi/forefireAPI.php?';

AFRAME.registerComponent('flow-tracer', {
    
    schema: {
        number_of_particles: {type: 'number', default: 5000},
        target_advect_per_s : {type: 'number', default: 30 },
        trail_length: {type: 'number', default: 100},
        flowTracerSpeed: {type: 'number', default: 100},
        raycast_plane: {type: 'boolean', default: true},
        scale: {type: 'number', default: 1000000},
        
        alphaMap: {type: 'string', default: "none"},
        datafile: {type: 'string', default: "none"},
        demFile: {type: 'string', default: "none"},
        demColumns: {type: 'number', default: 10}, 
        demLines: {type: 'number', default: 10},
        dataColumns: {type: 'number', default: 10}, 
        dataLines: {type: 'number', default: 10},
        demMax: {type: 'number', default: 10},
        demTexture: {type: 'string', default: "none"},
        zInteractShift: {type: 'number', default: 0},
        dataPointResolutionAlongX: {type: 'number', default:100}, // one point equals 1000 meters by default
        dataPointResolutionAlongY: {type: 'number', default:100}, // one point equals 1000 meters by default
        verticalExageration: {type: 'number', default: 1}
    },
    
    init: function() {
        this.resolution  = this.data.scale; // one real meter equals this.data.scale meters
        this.dataPointResolution = this.data.dataPointResolution;
        this.maxAltitude = this.data.demMax;
        this.zInteractShift = this.data.zInteractShift;
        const corsicanNames = [
            "MagicFigatelli",
            "FageoleRossu",
            "VelluAzzurro",
            "LunaNivale",
            "StellaFulminante",
            "MontuSerenu",
            "RosaBlu",
            "VentoSorriso",
            "SoleDiCorsica",
            "OndaLuminosa",
            "BoscoIncantato",
            "FalceDorata",
            "DragoRugiente",
            "GocciaDiMirto",
            "PietraPregiata",
            "FioreEterno",
            "AlbaMagica",
            "NotteStellata",
            "RiflessoArgenteo",
            "CuoreValente",
            "VitaFresca",
            "ArcobalenoSplendente",
            "SmeraldoLuminoso",
            "TramontoRosso",
            "NebbiaMistica",
            "AuroraCristallina",
            "TempestaCalma",
            "RosaSelvatica",
            "LagoTrasparente",
            "IsolaParadiso"
        ];

        // Select a random name from the array
        this.nickname = corsicanNames[Math.floor(Math.random() * corsicanNames.length)];
        this.interactPath = "interactiveAR";
        
        this.extents = {
            width: (this.data.dataColumns * this.data.dataPointResolutionAlongX) / this.resolution,
            height: (this.data.dataLines * this.data.dataPointResolutionAlongY) / this.resolution
        };
        this.origin = {
            x: -(this.extents.width / 2),
            y: -(this.extents.height / 2)
        };

        this.zScaleFactor = this.data.verticalExageration / 65536; // data is scaled over uint16 max value = 2**16 = 65536

        console.log("Inited Loaded ", this.origin, this.extents, this.zScaleFactor, this.data.zScaleFactor);

        // Create terrain entity
        var terrainEntity = document.createElement('a-entity');
        terrainEntity.setAttribute('terrain-model', `map: ${this.data.demTexture}; dem: ${this.data.demFile}; planeWidth: ${this.extents.width}; planeHeight: ${this.extents.height}; segmentsWidth: ${+this.data.demColumns - 1}; segmentsHeight: ${+this.data.demLines - 1}; zPosition: ${this.data.verticalExageration}; alphaMap: ${this.data.alphaMap}`);

        // Conditionally set ID based on raycast_plane
        if (this.data.raycast_plane) {
            // If raycast_plane is true, create and append raycasting plane
            var raycastingPlane = document.createElement('a-entity');
            raycastingPlane.setAttribute('id', 'flow_map_caster');
            raycastingPlane.setAttribute('geometry', `primitive: plane; width: ${this.extents.width}; height: ${this.extents.height}`);
            raycastingPlane.setAttribute('material', 'color: blue; side: double; transparent: true; opacity: 0.0');
            raycastingPlane.setAttribute('position', `0 ${this.zScaleFactor * (this.maxAltitude - this.maxAltitude / 400)} 0`);
            raycastingPlane.setAttribute('rotation', '-90 0 0');
            raycastingPlane.classList.add('raycastable');

            this.el.appendChild(raycastingPlane);
        } else {
            // If raycast_plane is false, set ID to terrainEntity
            terrainEntity.setAttribute('id', 'flow_map_caster');
            terrainEntity.classList.add('raycastable');
        }

        this.el.appendChild(terrainEntity);
        
        this.isStopped = true;
        this.text_tracker = null;
        this.hand_control = null;
        this.spheres = {}; // Store spheres by name
        this.addSphere(this.nickname, 0, 2, 0); 
        fetch(this.data.datafile)
            .then(response => {
                if (!response.ok) {
                    throw new Error('Réseau ou réponse non valide.');
                }
                return response.blob();
            })
            .then(blob => JSZip.loadAsync(blob))
            .then(zip => {
                return zip.file('data.json').async('string');
            })
            .then(content => {
                this.data2D = JSON.parse(content);
                this.data2D.origin = this.origin;
                this.data2D.extents = this.extents;
                this.timeIndices = Object.keys(this.data2D.data);
                this.tickTimeDelta = 0;
                this.tickTime = 0;
                console.log("Data unzipped load" + this.data2D.altitude[10][10]);

                for (var i = 0; i < this.data2D.altitude.length; i += 1) {
                    for (var j = 0; j < this.data2D.altitude[0].length; j += 1) {
                        this.data2D.altitude[i][j] = (this.data2D.altitude[i][j] + 10) * this.zScaleFactor + (this.zScaleFactor / 10);
                    }
                }
                console.log("Data unzipped after" + this.data2D.altitude[10][10]);
                this.pointsGeometry = new THREE.BufferGeometry();
                this.trail_length = this.data.trail_length;
                this.flowTracerSpeed = this.data.flowTracerSpeed;
                this.cMaxAps = 1000.0 / this.data.target_advect_per_s;
                this.speedups_values = [-3600, -600, -60, 0, 60, 600, 3600];
                this.speedups_text = ["an hour back", "10 minutes back", "a minute back", "nothing", "a minute", "10 minutes", "an hour"];

                this.speedup_index = 5;

                this.interactionMode = NETWORK;

                // FIRE SIMULATION STUFF
                this.fcastPath = 0
                this.currentSimUpdateDuration = 0;
                this.simRefreshDelta = 1000;
                this.interactionPossible = true;

                this.sim_speedup = this.speedups_values[this.speedup_index];

                this.time_step_ms = this.sim_speedup * this.cMaxAps;

                this.currentAdvDuration = 0;

                this.number_of_particles = this.data.number_of_particles;
                this.initial_time = this.timeIndices[0];
                this.end_time = this.timeIndices[this.timeIndices.length - 1];
                this.timeIndices_delta = this.timeIndices[1] - this.timeIndices[0];
                this.current_time = this.timeIndices[0];
                this.simMaxTime = this.current_time;
                this.simMinTime = this.current_time;
                this.timeIndex1 = +this.initial_time;
                this.timeIndex2 = +this.initial_time + +this.timeIndices_delta;
                this.value_bounds = this.data2D.value_bounds;
                this.rIndices = 1;
                console.log(" Data Loaded " + getDateTimeString(this.timeIndex1) + " to " + getDateTimeString(this.timeIndex2));
                this.shootOK = true;
                this.lastShootOK = 0;
                this.trail_index = 0;

                this.positions = new Float32Array(this.number_of_particles * 4); // 4 vertices per point
                this.ages = new Float32Array(this.number_of_particles); // next update time
                this.trail = new Float32Array(this.number_of_particles * 4 * this.trail_length); // 4 vertices per point
                this.trailvalues = new Float32Array(this.number_of_particles * 1 * this.trail_length);

                this.maxOverallSpeed = Math.max(
                    Math.sqrt(Math.pow(this.value_bounds.U[0], 2) + Math.pow(this.value_bounds.V[0], 2)),
                    Math.sqrt(Math.pow(this.value_bounds.U[0], 2) + Math.pow(this.value_bounds.V[1], 2)),
                    Math.sqrt(Math.pow(this.value_bounds.U[1], 2) + Math.pow(this.value_bounds.V[0], 2)),
                    Math.sqrt(Math.pow(this.value_bounds.U[1], 2) + Math.pow(this.value_bounds.V[1], 2))
                );
                console.log("MaxR is ", this.maxOverallSpeed);
                this.cflcondition = this.resolution / this.maxOverallSpeed;

                for (var i = 0; i < this.number_of_particles * 4; i += 4) {
                    this.positions[i] = this.origin.x + Math.random() * this.extents.width;
                    this.positions[i + 2] = this.origin.y + Math.random() * this.extents.height;
                    rloc = interpolateAt(this.data2D, this.positions[i], this.positions[i + 2], this.timeIndex1, this.timeIndex2, this.rIndices);
                    this.positions[i + 1] = rloc.z;
                    this.positions[i + 3] = 9999;
                }
                for (var i = 0; i < this.number_of_particles; i += 1) {
                    this.ages[i] = Math.random() * +this.trail_length;
                }
                for (var itrail = 0; itrail < this.trail_length; itrail += 1) {
                    var start_pi = itrail * this.number_of_particles * 4;
                    for (var i = 0; i < this.number_of_particles * 4; i += 4) {
                        this.trail[start_pi + i] = this.positions[i];
                        this.trail[start_pi + i + 1] = this.positions[i + 1];
                        this.trail[start_pi + i + 2] = this.positions[i + 2];
                        this.trail[start_pi + i + 3] = 20.0;
                        this.trailvalues[start_pi / 4 + i / 4] = this.positions[i + 3];
                    }
                }

                this.pointsGeometry.setAttribute('position', new THREE.BufferAttribute(this.trail, 4));
                this.pointsGeometry.setAttribute('colorIndex', new THREE.BufferAttribute(this.trailvalues, 1));

                var pointsMaterial = new THREE.ShaderMaterial({
                    uniforms: {
                        size: { value: 5 },
                        minClampValue: { value: 0.0 },
                        maxClampValue: { value: 30. }
                    },
                    vertexShader:
                        `
                        attribute float colorIndex;
                        uniform float size;
                        varying float vColorIndex;
                        void main() {
                            vec4 mvPosition = modelViewMatrix * vec4(position, 1);
                            gl_PointSize = size ;
                            gl_Position = projectionMatrix * mvPosition;
                            vColorIndex = colorIndex;  
                        }
                    `,
                    fragmentShader: `
                            varying float vColorIndex;
                            uniform float minClampValue;
                            uniform float maxClampValue;
                            float colormap_red(float x) {
                                if (x < 100.0) {
                                    return (-9.55123422981038E-02 * x + 5.86981763554179E+00) * x - 3.13964093701986E+00;
                                } else {
                                    return 5.25591836734694E+00 * x - 8.32322857142857E+02;
                                }
                            }

                            float colormap_green(float x) {
                                if (x < 150.0) {
                                    return 5.24448979591837E+00 * x - 3.20842448979592E+02;
                                } else {
                                    return -5.25673469387755E+00 * x + 1.34195877551020E+03;
                                }
                            }

                            float colormap_blue(float x) {
                                if (x < 80.0) {
                                    return 4.59774436090226E+00 * x - 2.26315789473684E+00;
                                } else {
                                    return -5.25112244897959E+00 * x + 8.30385102040816E+02;
                                }
                            }
                            float colormap_alpha(float x) {
                                 if (x < 120.0) {
                                    return 51.0 + 1.709 * x;
                                } else {
                                    return 255.0;
                                }
                            }

                            vec4 colormap(float x) {
                                float t = x*100.0;
                                float r = clamp(colormap_red(t) / 255.0, 0.0, 1.0);
                                float g = clamp(colormap_green(t) / 255.0, 0.0, 1.0);
                                float b = clamp(colormap_blue(t) / 255.0, 0.0, 1.0);
                                float a = clamp(colormap_alpha(t) / 255.0, 0.0, 1.0);
                                return vec4(r, g, b, 1.0);
                            }
                             void main() { 
                                float indexFactor = clamp(vColorIndex, minClampValue, maxClampValue);
                                gl_FragColor = colormap(indexFactor); // Combines rgb with opacity
                            }
                    `,
                    depthTest: true,
                    transparent: true
                });

                pointsMaterial.uniforms.minClampValue.value = 0;
                pointsMaterial.uniforms.maxClampValue.value = this.maxOverallSpeed / 2;
                this.points = new THREE.Points(this.pointsGeometry, pointsMaterial);
                this.el.setObject3D('points', this.points);
                console.log(pointsMaterial.uniforms.minClampValue.value, pointsMaterial.uniforms.maxClampValue.value)

                this.fireParts = {};

                this.number_of_inject = 5000;
                this.injected = new Float32Array(this.number_of_inject * 4); // 4 vertices per point
                for (var i = 0; i < this.number_of_inject * 4; i += 4) {
                    this.injected[i] = this.origin.x;
                    this.injected[i + 2] = this.origin.y;
                    rloc = interpolateAt(this.data2D, this.injected[i], this.injected[i + 2], this.timeIndex1, this.timeIndex2, this.rIndices);
                    this.injected[i + 1] = rloc.z;
                    this.injected[i + 3] = 1;
                }

                this.injectCount = 0;

                var injectMaterial = new THREE.ShaderMaterial({
                    uniforms: {
                        size: { value: 10 },
                        color: { value: new THREE.Color(1.0, 1.0, 1.0) }
                    },
                    vertexShader:
                        `   uniform float size;
                        varying vec3 vPosition;
                        void main() {
                            vPosition = position;
                            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                            gl_PointSize = size ;
                            gl_Position = projectionMatrix * mvPosition;
                        }
                    `,
                    fragmentShader:
                        `   uniform vec3 color;
                        varying vec3 vPosition;
                        void main() {
                            vec2 circCoord = 2.0 * gl_PointCoord - 1.0;
                            if (dot(circCoord, circCoord) > 1.0) {
                                discard;
                            }
                            gl_FragColor = vec4(color, 1.0);
                        }
                    `,
                    depthTest: true,
                    transparent: true
                });

                this.injectGeometry = new THREE.BufferGeometry();
                this.injectGeometry.setAttribute('position', new THREE.BufferAttribute(this.injected, 4));
                this.injectPoints = new THREE.Points(this.injectGeometry, injectMaterial);

                this.injectPoints.frustumCulled = false;

                this.el.setObject3D('injections', this.injectPoints);

                this.isStopped = false;
            
            
                this.powerNetwork = getAllNodesWithTypes();       
                this.networkInfoText = printCost();    
                            // Initialize network node count
                this.networkNodeCount = this.powerNetwork.length;

                // Initialize arrays for network node positions and colors
                this.networkPositions = new Float32Array(this.networkNodeCount * 4); // x, y, z, w per node
                this.networkColors = new Float32Array(this.networkNodeCount * 3); // r, g, b per node

                // Create geometry and set attributes
                this.networkGeometry = new THREE.BufferGeometry();
                this.networkGeometry.setAttribute('position', new THREE.BufferAttribute(this.networkPositions, 4));
                this.networkGeometry.setAttribute('color', new THREE.BufferAttribute(this.networkColors, 3));

                // Create material for network nodes
                this.networkMaterial = new THREE.ShaderMaterial({
                    uniforms: {
                        size: { value: 30 }, // Adjust the size as needed
                        time: { value: 0.0 } // For animations
                    },
                    
                    vertexShader: `
                        uniform float size;
                        uniform float time;
                        attribute vec3 color;
                        varying vec3 vColor;
                        varying float vTime;
                        void main() {
                            vColor = color;
                            vTime = time;
                            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                            gl_PointSize = size;
                            gl_Position = projectionMatrix * mvPosition;
                        }
                    `,
                    fragmentShader: `
                     varying vec3 vColor;
                    varying float vTime;
                    void main() {
                        vec2 coord = gl_PointCoord - vec2(0.5);
                        float dist = length(coord);

                        // Use step for a sharp edge
                        float gradient = step(dist, 0.5);

                        // Pulsating effect
                        float pulse = 0.75 + 0.25 * sin(vTime * 4.0); // Adjusted amplitude and frequency

                        // Combine gradient and pulse
                        vec3 color = vColor * pulse;

                        // Alpha is either 1.0 or 0.0 for sharp edges
                        gl_FragColor = vec4(color, gradient);
                    }
                    `,
                    depthTest: true,
                    transparent: true
                });

                this.networkMaterial = this.networkMaterial;
                // Create Points object
                this.networkPoints = new THREE.Points(this.networkGeometry, this.networkMaterial);
                this.networkPoints.frustumCulled = false; // Ensure points are always rendered

                // Add network points to the scene
                this.el.setObject3D('networkPoints', this.networkPoints);

                // Initial refresh of the network
                this.refreshNetwork();
            
            
            
            if (this.interactPath != 0){
                       fetch(firecasterAPI+"command=clearPositions&path="+this.interactPath) 
                        .then(response => {
                            if (!response.ok) {
                                throw new Error('Network response was not ok.');
                            }
                           console.log(this.nickname, response.json());
                            
                        });
                    

                    }
            
            
            
            
            
            

            })
            .catch(error => console.error('Erreur lors du chargement du fichier JSON:', error));
    },
    refreshNetwork: function() {
        // Recompute powerNetwork in case it has updated
        this.powerNetwork = getAllNodesWithTypes();
        var nodeCount = this.powerNetwork.length;

        // If the number of nodes has changed, recreate the arrays and attributes
        if (nodeCount !== this.networkNodeCount) {
            this.networkNodeCount = nodeCount;
            this.networkPositions = new Float32Array(this.networkNodeCount * 4);
            this.networkColors = new Float32Array(this.networkNodeCount * 3);
            this.networkGeometry.setAttribute('position', new THREE.BufferAttribute(this.networkPositions, 4));
            this.networkGeometry.setAttribute('color', new THREE.BufferAttribute(this.networkColors, 3));
        }

        for (var i = 0; i < this.powerNetwork.length; i++) {
            var node = this.powerNetwork[i];
            var geohash = node.id;
            var type = node.type;

            // Decode geohash to get lat, lon
            var [lat, lon] = decodeGeoHash(geohash);

            // Transform lat/lon to x,z (and later get y)
            var point = transformLatLonToPoint(lat, lon, this.data2D.BBox, this.origin, this.extents);

            var x = point.x;
            var z = point.y;

            // Get y coordinate via interpolateAt
            var rloc = interpolateAt(this.data2D, x, z, this.timeIndex1, this.timeIndex2, this.rIndices);
            var y = rloc.z + 0.01; // Adjust as needed

            // Set position in networkPositions array
            this.networkPositions[i * 4] = x;
            this.networkPositions[i * 4 + 1] = y;
            this.networkPositions[i * 4 + 2] = z;
            this.networkPositions[i * 4 + 3] = 1; // Optional w component

            // Set color based on type
            var color = new THREE.Color();

            if (type === 2) {
                color.set('green');
            } else if (type === 1) {
                color.set('red');
            } else if (type === 0) {
                color.set('orange');
            } else {
                color.set('white'); // Default color
            }

            // Set color in networkColors array
            this.networkColors[i * 3] = color.r;
            this.networkColors[i * 3 + 1] = color.g;
            this.networkColors[i * 3 + 2] = color.b;
        }

        // Mark attributes as needing update
        this.networkGeometry.attributes.position.needsUpdate = true;
        this.networkGeometry.attributes.color.needsUpdate = true;
    },
    setInjectionColor: function(red, green, blue) {
        if (this.injectPoints && this.injectPoints.material && this.injectPoints.material.uniforms.color) {
            this.injectPoints.material.uniforms.color.value.setRGB(red, green, blue);
        }
    },

    getSimulationInfo: function() {
        var newSTR = getDateTimeString(this.current_time);
        newSTR += " - One second is " + this.speedups_text[this.speedup_index];
        newSTR += "\n1m=" + this.resolution + "m A fast B slow ";
        if (this.interactionMode == LAGRANGIAN) {
            newSTR += "trigger SMOKE";
        }
        if (this.interactionMode == FIRECASTER) {
            newSTR += "trigger FIRE";
        }
        if (this.interactionMode == RAIN) {
            newSTR += "trigger RAIN";
        }
        if (this.interactionMode == NETWORK) {
            newSTR += "trigger NETWORK";
        }
        return newSTR;
    },

    loadFirePartsIntoInjected: function() {
        let index = 0;
        const currentTime = new Date(this.current_time);
        const keys = Object.keys(this.fireParts)
            .filter(key => new Date(key) < currentTime)
            .sort((a, b) => new Date(b) - new Date(a));
        for (var i = 0; i < this.number_of_inject * 4; i += 4) {
            this.injected[i] = this.origin.x;
            this.injected[i + 2] = this.origin.y;
        }
        for (let key of keys) {
            const points = this.fireParts[key];
            for (let point of points) {
                if (index < this.injected.length - 4) {
                    this.injected[index] = point.x;
                    this.injected[index + 2] = point.y;
                    let rloc = interpolateAt(this.data2D, this.injected[index], this.injected[index + 2], this.timeIndex1, this.timeIndex2, this.rIndices);
                    this.injected[index + 1] = rloc.z + 0.001;
                    this.injected[index + 3] = 1;
                    index += 4;
                } else {
                    console.warn("Injected array is full, some points may not be loaded.");
                    break;
                }
            }
        }
    },
 switchInteractionMode: function() { 
        
          if(this.interactionPossible == false){
           return;
       }
        this.interactionPossible = false;
        
            if (this.interactionMode == FIRECASTER){
                 this.interactionMode = LAGRANGIAN;
                  this.setInjectionColor(0.9, 0.9, 0.9);
            }else{
                if (this.interactionMode == LAGRANGIAN){
                    this.interactionMode = RAIN;
                   this.setInjectionColor(0.5, 0.5, 1.0);
                }else{
                    if (this.interactionMode == RAIN){
                        initGraph();
                        this.interactionMode = NETWORK;
                          this.setInjectionColor(1.0, 0.5, 0.1);
                    }else{
                    if (this.interactionMode == NETWORK){
                        this.interactionMode = FIRECASTER;
                          this.setInjectionColor(1.0, 0.5, 0.5);
                    }
                }
            
            }
            }
 
    },
    loadFireAsync: function(){
        
  fetch(firecasterAPI+'command=getCompiledState&path='+this.fcastPath+'&element=fronts&indice=all&apikey=null') // Make sure the path to hurray.json is correct
        .then(response => {
            if (!response.ok) {
                throw new Error('Network response was not ok.');
            }
            return response.json(); // Use .json() for JSON data
        })
        .then(data => {
            // Modified parseCoordinates to project each point
            const parseCoordinates = (coordinatesString, bbox, origin, extents) => {
              return coordinatesString.split(' ').map(coord => {
                const [lon, lat, z] = coord.split(',').map(parseFloat); // Assuming lon,lat order in the string
                // Project the lat, lon to the new coordinate system
                return transformLatLonToPoint(lat, lon, bbox, origin, extents);
                 
              });
            };


            data.fronts.forEach(front => {
              // Project and parse coordinates for each front
              this.fireParts[front.date] = parseCoordinates(front.coordinates, this.data2D.BBox, this.origin, this.extents);
            });
        
            let maxDate = new Date(0); // Initialize with the earliest possible date
            let minDate = new Date(); // Initialize with the current date
            Object.keys(this.fireParts).forEach(dateStr => {
              const date = new Date(dateStr);
                
              if (date > maxDate) {
                maxDate = date; // Update maxDate if the current date is later
              }
              if (date < minDate) {
                      minDate = date; // Update minDate if the current date is earlier
                }
            });

            this.simMaxTime = maxDate.getTime();
            this.simMinTime = minDate.getTime();
        

        })
        .catch(error => {
            console.error('There has been a problem with your fetch operation:', error);
        });
    },
    injectParticleXY: function(intersectionPoint) {
        var NX = intersectionPoint.x;
        var NY = intersectionPoint.z;
        if (NX < this.origin.x || NX > this.origin.x + this.extents.width ||
            NY < this.origin.y || NY > this.origin.y + this.extents.height) {
            return;
        }

        if (this.interactionMode == LAGRANGIAN || this.interactionMode === RAIN || this.interactionMode == NETWORK) {
            if (!this.shootOK) {
                return;
            }
            if (this.injectCount >= this.number_of_inject) {
                this.injectCount = 0;
            }

            rloc = interpolateAt(this.data2D, NX, NY, this.timeIndex1, this.timeIndex2, this.rIndices);
            this.injected[this.injectCount * 4] = NX;
            this.injected[this.injectCount * 4 + 2] = NY;
            this.injected[this.injectCount * 4 + 1] = rloc.z;
            this.injected[this.injectCount * 4 + 3] = 1;

            this.injectCount += 1;
            this.shootOK = true;
        }
        if (this.interactionMode == NETWORK) {
            this.powerNetwork = getAllNodesWithTypes();
            console.log(intersectionPoint.x, intersectionPoint.z);
            const { lat, lon } = transformPointToLatLon(intersectionPoint.x, intersectionPoint.z, this.data2D.BBox, this.origin, this.extents);
            clickEvent(lat, lon);
            
              this.refreshNetwork();
            this.networkInfoText = printCost();
            this.text_tracker.update_status(this.networkInfoText);
            
            
            
            
            
          
        }
        if (this.interactionMode == FIRECASTER) {
            if (this.interactionPossible == false) {
                return;
            }
            this.interactionPossible = false;

            if (this.fcastPath == 0) {
                const currentDate = new Date();
                const pathDate = formatDateForPath(currentDate);
                const isoDate = formatDateForDateParam(new Date(this.current_time));

                const { lat, lon } = transformPointToLatLon(NX, NY, this.data2D.BBox, this.origin, this.extents);
                const encodedStringCoordinates = encodeCoordinate(lat, lon);
                const params = {
                    command: 'init',
                    path: pathDate,
                    message: 'CEMER',
                    coords: encodedStringCoordinates,
                    ventX: 20,
                    ventY: 20,
                    date: isoDate,
                    model: 'Rothermel',
                    apikey: 'null'
                };
                const queryString = Object.keys(params)
                    .map(key => encodeURIComponent(key) + '=' + encodeURIComponent(params[key]))
                    .join('&');

                fetch(firecasterAPI + queryString)
                    .then(response => {
                        if (!response.ok) {
                            throw new Error('Network response was not ok.');
                        }
                        return response.json();
                    }).then(data => {
                });

                this.fcastPath = pathDate;
                
                console.log(queryString);
            } else {
                const isoDate = formatDateForDateParam(new Date(this.current_time));
                const { lat, lon } = transformPointToLatLon(NX, NY, this.data2D.BBox, this.origin, this.extents);
                const encodedStringCoordinates = encodeCoordinate(lat, lon);
                const actionParams = {
                    command: 'action',
                    path: this.fcastPath,
                    date: isoDate,
                    domain: 'WORLD',
                    action: 'addIgnition',
                    coords: encodedStringCoordinates,
                    apikey: 'null'
                };
                const queryString = Object.keys(actionParams)
                    .map(key => encodeURIComponent(key) + '=' + encodeURIComponent(actionParams[key]))
                    .join('&');

                console.log("added ignition ", firecasterAPI + queryString);
                fetch(firecasterAPI + queryString)
                    .then(response => {
                        if (!response.ok) {
                            throw new Error('Network response was not ok.');
                        }
                        return response.json();
                    }).then(data => {
                });
            }
        }
    },

    setTextTracker: function(tcomp) {
        this.text_tracker = tcomp;
    },
    togglePause: function() {
        this.isStopped = !this.isStopped;
    },
    setHandControl: function(tcomp) {
        this.hand_control = tcomp;
        this.hand_control.setControlled(this);
    },

    update_info: function(new_text) {
        this.text_tracker.update_info(new_text);
    },

    togglePlay: function() {
        this.isStopped = !this.isStopped;
    },

    speedUp: function() {
        if (this.speedup_index < this.speedups_values.length - 1) {
            this.speedup_index = this.speedup_index + 1;
        }
        this.sim_speedup = this.speedups_values[this.speedup_index];
    },

    speedDown: function() {
        if (this.speedup_index > 0) {
            this.speedup_index = this.speedup_index - 1;
        }
        this.sim_speedup = this.speedups_values[this.speedup_index];
    },

    changeDate: function(newTime) {
        this.current_time = newTime;
    },

    tick: function(time, timeDelta) {
        if (!this.isStopped){
            
            if (this.networkMaterial) {
                this.networkMaterial.uniforms.time.value = time / 800.0; // Convert time to seconds
            }
            
            
            this.currentAdvDuration += +timeDelta;
            if (this.currentAdvDuration < this.cMaxAps){
                return;
            }
            this.currentAdvDuration = 0;
            
            this.currentSimUpdateDuration += +timeDelta;
            if (this.currentSimUpdateDuration > this.simRefreshDelta){
                
                this.currentSimUpdateDuration = 0;
                this.interactionPossible = true;
                
                if (this.fcastPath != 0){
                    this.loadFireAsync();    
                
                    if (this.current_time > this.simMaxTime){
                       fetch(firecasterAPI+"command=step&path="+this.fcastPath) 
                        .then(response => {
                            if (!response.ok) {
                                throw new Error('Network response was not ok.');
                            }
                            return response.json(); // Use .json() for JSON data
                        }).then(data => {

                      });

                    }
                }
                if (this.interactPath != 0){
                     myVP = document.querySelector("a-scene").camera.el.parentNode.object3D.position;
                     mycam = document.querySelector("a-scene").camera.el.object3D.position;
                     
                       fetch(firecasterAPI+"command=setPos&path="+this.interactPath+"&pseudo="+this.nickname+"&xx="+(myVP.x-mycam.x)+"&yy="+(myVP.y-mycam.y+this.zInteractShift)+"&zz="+(myVP.z-mycam.z)) 
                        .then(response => {
                            if (!response.ok) {
                                throw new Error('Network response was not ok.');
                            }
                            
                        });
                    
                        fetch(firecasterAPI+"command=getPos&path="+this.interactPath) 
                            .then(response => {
                                if (!response.ok) {
                                    throw new Error('Network response was not ok.');
                                }
                                return response.json(); // Use .json() for JSON data
                            }).then(data => {
                                
                                // Loop over each key-value pair in the data object
                                for (const [name, positionString] of Object.entries(data)) {
                                    const [xStr, yStr, zStr] = positionString.split(':');
                                    const x = parseFloat(xStr);
                                    const y = parseFloat(yStr);
                                    const z = parseFloat(zStr);

                                    if (this.spheres[name]) {
                                        // If the sphere exists, move it to the new location
                                        this.moveSphere(name, x, y, z);
                                    } else {
                                        // If the sphere doesn't exist, create it at the new location
                                        this.addSphere(name, x, y, z);
                                    }
                                }
                                
                            })
                            .catch(error => {
                                console.error('There has been a problem with your fetch operation:', error);
                            });

                    }
                
                
                
                
            }
            
            
            this.shootOK = true;
           //
            this.tickTimeDelta = timeDelta;
            this.tickTime = time;
            this.time_step_ms = this.sim_speedup*this.cMaxAps;
            
            this.current_time = +this.current_time+ +this.time_step_ms;
            if(this.current_time > this.end_time){
                this.current_time = this.initial_time;
            }
            if(this.current_time < this.initial_time){
                this.current_time = +this.end_time- 1.0;
            }
            var rTime = (this.current_time - this.initial_time) / this.timeIndices_delta;
            var rsimmaxTime = (this.simMaxTime - this.initial_time) / this.timeIndices_delta;
            var rsimminTime = (this.simMinTime - this.initial_time) / this.timeIndices_delta;
            // Calculate timeIndex1 and timeIndex2
            this.timeIndex1 = +this.initial_time + Math.floor(rTime) * this.timeIndices_delta;
            this.timeIndex2 = +this.timeIndex1 + +this.timeIndices_delta;

            // Calculate rIndices as the fractional part of rTime
            this.rIndices = 1-(rTime % 1);
        
            
            if (this.text_tracker != null){
                
                this.text_tracker.set_progress(rTime/this.timeIndices.length);
                this.text_tracker.set_simmaxtime(rsimmaxTime/this.timeIndices.length);
                this.text_tracker.set_simmintime(rsimminTime/this.timeIndices.length);
                this.update_info(this.getSimulationInfo());
            } 
            
            
            
            this.trail_index = this.trail_index+1;
            if(this.trail_index >=this.trail_length){
                this.trail_index = 0; 
            }

            
            if (this.interactionMode == FIRECASTER){
                 this.loadFirePartsIntoInjected();  
            }
            if (this.interactionMode == LAGRANGIAN){
               for (var i = 0; i < this.number_of_inject * 4; i += 4) {
                rloc = interpolateAt(this.data2D, this.injected[i], this.injected[i+2],this.timeIndex1,this.timeIndex2,this.rIndices);  
                var NX = this.injected[i] + (rloc.u * +this.time_step_ms/1000.0 )/this.resolution;
                this.injected[i + 1] = rloc.z;
                var NY = this.injected[i + 2] + (rloc.v * +this.time_step_ms/1000.0 )/this.resolution;
                this.positions[i + 3] = Math.sqrt(rloc.v*rloc.v + rloc.u*rloc.u);
                
                if (this.injected[i] < this.origin.x || this.injected[i] > this.origin.x + this.extents.width ||
                        this.injected[i + 2] < this.origin.y || this.injected[i + 2] > this.origin.y + this.extents.height) {
                   //     this.injected[i] = this.origin.x + Math.random() * this.extents.width;
                        this.injected[i + 3] = 2;
                 }else{
                     if (this.positions[i + 3]>0){
                        this.injected[i] = NX;
                        this.injected[i + 2] = NY;
                     }
                 }
                 
                }
            }

            if (this.interactionMode == RAIN){
               for (var i = 0; i < this.number_of_inject * 4; i += 4) {
                rloc = interpolateRunoffAt(this.data2D, this.injected[i], this.injected[i+2],this.timeIndex1,this.timeIndex2,this.rIndices);  
                var NX = this.injected[i] + (rloc.u * +this.time_step_ms/1000.0 )/this.resolution;
                this.injected[i + 1] = rloc.z;
                var NY = this.injected[i + 2] + (rloc.v * +this.time_step_ms/1000.0 )/this.resolution;
                this.positions[i + 3] = Math.sqrt(rloc.v*rloc.v + rloc.u*rloc.u);
                
                if (this.injected[i] < this.origin.x || this.injected[i] > this.origin.x + this.extents.width ||
                        this.injected[i + 2] < this.origin.y || this.injected[i + 2] > this.origin.y + this.extents.height) {
                   //     this.injected[i] = this.origin.x + Math.random() * this.extents.width;
                        this.injected[i + 3] = 2;
                 }else{
                     if (this.positions[i + 3]>0){
                        this.injected[i] = NX;
                        this.injected[i + 2] = NY;
                     }
                 }
                 
                }
            }
            
            var viewSpeedCoeff =  (this.cMaxAps* this.flowTracerSpeed )/this.resolution;
            
            for (var i = 0; i < this.number_of_particles * 4; i += 4) {
               
                rloc = interpolateAt(this.data2D, this.positions[i], this.positions[i+2],this.timeIndex1,this.timeIndex2,this.rIndices);  
                let new_v = 0 ;
                let new_u = 0;
                
              //  if(this.positions[i+3]>0){   
                    let scaled_magnitude = Math.pow(this.positions[i+3], 1); // 'a' is the power factor, less than 1
                 
                    new_u =  rloc.u ;//* scaled_magnitude / this.positions[i+3] ;
                    new_v =  rloc.v ;//* scaled_magnitude / this.positions[i+3] ;
               // }
                this.positions[i] += new_u * viewSpeedCoeff;
                this.positions[i + 2] += new_v * viewSpeedCoeff;

                if (this.positions[i] < this.origin.x || this.positions[i] > this.origin.x + this.extents.width ||
                        this.positions[i + 2] < this.origin.y || this.positions[i + 2] > this.origin.y + this.extents.height) {
                        // Reset position within the bounds
                        this.positions[i] = this.origin.x + Math.random() * this.extents.width;
                        this.positions[i + 2] = this.origin.y + Math.random() * this.extents.height;
                 }


             //demColumns   rloc = interpolateAt(this.data2D, this.positions[i], this.positions[i+2],this.timeIndex1,this.timeIndex2,this.rIndices);
                this.positions[i + 1] = rloc.z; 
                this.positions[i + 3] = Math.sqrt(rloc.v*rloc.v + rloc.u*rloc.u);

            
            }

            // handle the trail (update oldest position with newest)
            var start_pi = this.trail_index*this.number_of_particles * 4;
            for (var i = 0; i < this.number_of_particles * 4; i += 4) {
                this.trail[start_pi+i] = this.positions[i]  ;
                this.trail[start_pi+i+1] = this.positions[i + 1] ;
                this.trail[start_pi+i+2] = this.positions[i + 2] ;
                this.trail[start_pi+i+3] = this.positions[i + 3]/(this.maxOverallSpeed/5.0) ;
            }
            var start_piv = this.trail_index*this.number_of_particles;
            for (var i = 0; i < this.number_of_particles ; i += 1) {
                this.trailvalues[start_piv+i] = this.trail[start_pi+i*4+3];
                this.ages[i] += 1;
                if (this.ages[i] >  +this.trail_length ) {
                    this.positions[i*4] = this.origin.x + Math.random() * this.extents.width;
                    this.positions[i*4 + 2] = this.origin.y + Math.random() * this.extents.height;
                    rloc = interpolateAt(this.data2D, this.positions[i*4], this.positions[i*4 + 2],this.timeIndex1,this.timeIndex2,this.rIndices);
                    this.positions[i*4 + 1] = rloc.z;
                    this.positions[i*4 + 3] = Math.sqrt(rloc.v*rloc.v + rloc.u*rloc.u);
                    this.ages[i] = 0;
                }
            }
            // Update the geometry
            this.injectGeometry.attributes.position.needsUpdate = true;
            this.pointsGeometry.attributes.position.needsUpdate = true;
            this.pointsGeometry.attributes.colorIndex.needsUpdate = true;
        }
    },
    
    addSphere: function(name, x, y, z) {
        var sphere = document.createElement('a-sphere');
        sphere.setAttribute('position', { x: x, y: y, z: z });
        sphere.setAttribute('radius', 0.05);

        // Set random bright color
        var colors = ['#FF0000', '#FF1493', '#FF69B4', '#FFC0CB', '#FF4500', '#FF6347', '#FFD700', '#FFA500'];
        var randomColor = colors[Math.floor(Math.random() * colors.length)];
        sphere.setAttribute('color', randomColor);

        // Create text entity
        var textEntity = document.createElement('a-entity');
        textEntity.setAttribute('text', {
            value: name,
            color: 'white',
            align: 'center',
            width: 1, // Adjusted width to make text smaller
            side: 'double',
            wrapCount: 15
        });
        textEntity.setAttribute('position', { x: x, y: y + 0.15, z: z }); // Position text above the sphere
        textEntity.setAttribute('scale', '0.5 0.5 0.5'); // Make the text even smaller if needed

        // Append sphere and text to the scene
        this.el.appendChild(sphere);
        this.el.appendChild(textEntity);

        // Store references
        this.spheres[name] = { sphere: sphere, text: textEntity };
    },

    moveSphere: function(name, x, y, z) {
        const sphereObj = this.spheres[name];
        if (!sphereObj) {
            console.warn(`Sphere with name "${name}" does not exist.`);
            return null;
        }

        const sphere = sphereObj.sphere;
        const text = sphereObj.text;
        if (!sphere) {
            console.warn(`Sphere entity for "${name}" is missing.`);
            return null;
        }
        sphere.setAttribute('position', { x: x, y: y, z: z });
        if (text) {
            text.setAttribute('position', { x: x, y: y + 0.15, z: z }); // Move text along with sphere
        }
    },

    getSpherePosition: function(name) {
        const sphereObj = this.spheres[name];
        if (!sphereObj) {
            console.warn(`Sphere with name "${name}" does not exist.`);
            return null;
        }

        const sphere = sphereObj.sphere;
        if (!sphere) {
            console.warn(`Sphere entity for "${name}" is missing.`);
            return null;
        }

        const position = sphere.getAttribute('position');
        return position;
    }
    
});