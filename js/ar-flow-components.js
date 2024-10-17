AFRAME.registerComponent('play-component', {
    schema: {
      color: { default: 'green' }
    },

    init: function () {
      var data = this.data;
      var el = this.el; // Reference to the element this component is attached to
      var defaultColor = el.getAttribute('material').color;
   
      el.addEventListener('click', function () {
        el.setAttribute('material', 'color', data.color); // Change color on click
        var flowTracerComponent = document.getElementById('surface-current').components['flow-tracer'];
        if (flowTracerComponent) {
          flowTracerComponent.togglePlay(); // Toggle play
          console.log("Playing");
        }
      });

      // Reset color when not clicked
      el.addEventListener('mouseleave', function () {
        el.setAttribute('material', 'color', defaultColor);
      });
    }
});

// Pause Component
AFRAME.registerComponent('pause-component', {
    schema: {
      color: { default: 'red' }
    },

    init: function () {
      var data = this.data;
      var el = this.el; // Reference to the element this component is attached to
      var defaultColor = el.getAttribute('material').color;

      el.addEventListener('click', function () {
        el.setAttribute('material', 'color', data.color); // Change color on click
        var flowTracerComponent = document.getElementById('surface-current').components['flow-tracer'];
        if (flowTracerComponent) {
          flowTracerComponent.togglePause(); // Toggle pause
          console.log("Pausing");
        }
      });
        
      el.addEventListener('mouseleave', function () {
        el.setAttribute('material', 'color', defaultColor);
      });
    }
});



AFRAME.registerComponent('text-info', {
  schema: {
    defaultText: { default: 'Default Text' },
    progress: { default: 0, type: 'number' } // Progress value for the red bar
  },

  init: function () {
    // Create the text entity
    this.barWidth = 0.2;

      
    this.textInfo = document.createElement('a-text');
    this.textInfo.setAttribute('value', "Info");
    this.textInfo.setAttribute('color', 'lightgray');
    this.textInfo.setAttribute('position', '-0.1 0.004 -0.097'); // Slightly in front of the parent entity
    this.textInfo.setAttribute('scale', '0.04 0.04 0.04'); // Slightly in front of the parent entity
    this.el.appendChild(this.textInfo);
 
    this.textCredits = document.createElement('a-text');
    this.textCredits.setAttribute('value', "trmg a nxktg (Dati e Soldi)");
    this.textCredits.setAttribute('color', 'lightgray');
    this.textCredits.setAttribute('position', '-0.1 -0.008 -0.097'); // Slightly in front of the parent entity
    this.textCredits.setAttribute('scale', '0.02 0.02 0.02'); // Slightly in front of the parent entity
    this.el.appendChild(this.textCredits);
      
    this.textCredits2 = document.createElement('a-text');
    this.textCredits2.setAttribute('value', "DataViz Challenge 2024");
    this.textCredits2.setAttribute('color', 'lightgray');
    this.textCredits2.setAttribute('position', '-0.001 -0.008 -0.097'); // Slightly in front of the parent entity
    this.textCredits2.setAttribute('scale', '0.02 0.02 0.02'); // Slightly in front of the parent entity
    this.el.appendChild(this.textCredits2);    
      
    var plane = document.createElement('a-plane');
    plane.setAttribute('position', '0 0 -0.1'); // Below the text
    plane.setAttribute('width', this.barWidth); // Assuming full width
    plane.setAttribute('height', '0.03'); // 10% of the height
    plane.setAttribute('color', 'black');
    plane.setAttribute('material', 'opacity: 1');
    this.el.appendChild(plane);

    // Create the red bar
    this.bar = document.createElement('a-plane');
    this.bar.setAttribute('position', '0 0 -0.099'); // Start at the left, in front of the white plane
    this.bar.setAttribute('width', '0.002'); // Width of the bar
    this.bar.setAttribute('height', '0.03');
    this.bar.setAttribute('color', 'red');
    this.el.appendChild(this.bar);
      
    // Create the sim bar
    this.simbar = document.createElement('a-plane');
    this.simbar.setAttribute('position', '0 0 -0.099'); // Start at the left, in front of the white plane
    this.simbar.setAttribute('width', '0.002'); // Width of the bar
    this.simbar.setAttribute('height', '0.03');
    this.simbar.setAttribute('color', 'blue');
    this.el.appendChild(this.simbar);
      
    // Create the sim bar
    this.simMinbar = document.createElement('a-plane');
    this.simMinbar.setAttribute('position', '0 0 -0.099'); // Start at the left, in front of the white plane
    this.simMinbar.setAttribute('width', '0.002'); // Width of the bar
    this.simMinbar.setAttribute('height', '0.03');
    this.simMinbar.setAttribute('color', 'yellow');
    this.el.appendChild(this.simMinbar);  
    
      
    // Update the position of the red bar based on progress
    this.set_progress(this.data.progress);
    this.set_simmaxtime(this.data.simMaxTime);
    this.set_simmintime(this.data.simMinTime);
  },

  update: function (oldData) {
     if (oldData.progress !== this.data.progress) {
      this.set_progress(this.data.progress);
    }
  },

  set_progress: function (value) {
    var newPositionX =  +this.barWidth * value;
    this.bar.setAttribute('position', {x: this.barWidth * value -(this.barWidth/2), y: 0, z: -0.099}); 
  },  
    set_simmaxtime: function (value) {
    var newPositionX =  +this.barWidth * value;
    this.simbar.setAttribute('position', {x: this.barWidth * value -(this.barWidth/2), y: 0, z: -0.099}); 
  },
    set_simmintime: function (value) {
    var newPositionX =  +this.barWidth * value;
    this.simMinbar.setAttribute('position', {x: this.barWidth * value -(this.barWidth/2), y: 0, z: -0.099}); 
  },
 
  update_info: function (newText) {
     this.el.children[0].setAttribute('value', newText);
  },
  update_credits: function (newText) {
     this.el.children[1].setAttribute('value', newText);
  },
update_credits2: function (newText) {
     this.el.children[2].setAttribute('value', newText);
  }
});




AFRAME.registerComponent('shoot-controls', {
  // dependencies: ['tracked-controls'],
     
  schema: {
    hand: { default: 'left' }
  },

  init: function () {
    var self = this;
    this.flow_tracer = null;
    this.onButtonChanged = this.onButtonChanged.bind(this);
    var myMouse= { x: 0, y: 0 };
  },

  play: function () {
    var el = this.el;
    el.addEventListener('buttonchanged', this.onButtonChanged);
  },

  pause: function () {
    var el = this.el;
    el.removeEventListener('buttonchanged', this.onButtonChanged);
  },

  mapping: {
    axis0: 'trackpad',
    axis1: 'trackpad',
    button0: 'trackpad',
    button1: 'trigger',
    button2: 'grip',
    button3: 'menu',
    button4: 'system'
  },

  onButtonChanged: function (evt) {
    var buttonId = evt.detail.id;
    var buttonStates = evt.detail.state;
    //this.flow_tracer.update_info(buttonId+" "+buttonStates);
      if (buttonId === 4 && buttonStates.pressed) {
      this.flow_tracer.speedUp();
      }
    if (buttonId === 5 && buttonStates.pressed) {
      this.flow_tracer.speedDown();
      }
    // Check if the trigger (button 1) is pressed
    if (buttonId === 0 && buttonStates.pressed) {
      this.handleTriggerPress();
    }
    if (buttonId === 1 && buttonStates.pressed) {
        this.flow_tracer.switchInteractionMode();
 
    }
    
  },
 
  handleTriggerPress: function() {
  // Access the raycaster component
  var raycasterEl = this.el.components.raycaster;

  // Check if the raycaster is currently intersecting with any entities
  if (raycasterEl && raycasterEl.intersectedEls.length > 0) {
    // Iterate through intersected entities
    for (var i = 0; i < raycasterEl.intersectedEls.length; i++) {
      var intersectedEl = raycasterEl.intersectedEls[i];
 
      // Check if the intersected entity is the flow_map
      if (intersectedEl.id === 'flow_map_caster') {
        // Get the intersection detail
        var intersectionDetail = raycasterEl.getIntersection(intersectedEl);

        if (intersectionDetail) {
          // Intersection point with the flow_map
          var intersectionPoint = intersectionDetail.point;
         
          this.flow_tracer.injectParticleXY(intersectionPoint);
 
        }
      }
    }
  }
},
      handleMouseSpacePress: function (event) {
    if (event.code === 'Space') {
      var mouse = this.mouse;
      var camera = this.el.sceneEl.camera;
      var raycaster = new THREE.Raycaster();
 
        raycaster.setFromCamera(myMouse, camera);
      var flowMapEl = document.getElementById('flow_map_caster');
      if (!flowMapEl) return;

      var intersects = raycaster.intersectObject(flowMapEl.object3D, true);
        
      if (intersects.length > 0) {
        var intersectionPoint = intersects[0].point;
        
        this.flow_tracer.injectParticleXY(intersectionPoint);
      }
    }
  },
    setMousePosition: function(mousePos){
        myMouse = mousePos;
      
    }, 
    
    setControlled: function(tcomp) {

        this.flow_tracer = tcomp;
        
        this.flow_tracer.update_info("Waiting initialisation");
    },

  update: function () {
    var data = this.data;
    var el = this.el;
  }
});
