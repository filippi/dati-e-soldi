/**
 * Converts a 16-bit float to a 32-bit float.
 * @param {number} bits - The 16-bit float represented as an unsigned integer.
 * @returns {number} - The converted 32-bit float.
 */
function float16ToFloat32(bits) {
    const sign = (bits & 0x8000) >> 15;
    let exponent = (bits & 0x7C00) >> 10;
    let fraction = bits & 0x03FF;

    if (exponent === 0) {
        if (fraction === 0) {
            return sign === 1 ? -0 : 0;
        } else {
            // Subnormal number
            exponent = -14;
            while ((fraction & 0x0400) === 0) {
                fraction <<= 1;
                exponent -= 1;
            }
            fraction &= 0x03FF;
        }
    } else if (exponent === 0x1F) {
        if (fraction === 0) {
            return sign === 1 ? -Infinity : Infinity;
        } else {
            return NaN;
        }
    } else {
        exponent = exponent - 15;
    }

    const float32 = (sign === 1 ? -1 : 1) * (1 + fraction / 1024) * Math.pow(2, exponent);
    return float32;
}

/**
 * Reshapes a flat array into a nested array based on the provided shape.
 * @param {Array} array - The flat array to reshape.
 * @param {Array} shape - An array representing the desired shape.
 * @returns {Array} - The reshaped nested array.
 */
function reshape(array, shape) {
    if (shape.length === 0) {
        return array;
    }
    const [currentDim, ...restDims] = shape;
    const size = restDims.length > 0 ? restDims.reduce((a, b) => a * b, 1) : 1;
    const reshaped = [];
    for (let i = 0; i < currentDim; i++) {
        reshaped.push(reshape(array.slice(i * size, (i + 1) * size), restDims));
    }
    return reshaped;
}

/**
 * Deserializes binary data into a JSON-like structure.
 * @param {ArrayBuffer} arraybuffer - The binary data to deserialize.
 * @returns {Object} - The reconstructed JSON-like object.
 */
function bin2Json(arraybuffer) {
    const dataView = new DataView(arraybuffer);
    let offset = 0;

    // Helper function to read strings
    function readString(length) {
        let str = '';
        for (let i = 0; i < length; i++) {
            str += String.fromCharCode(dataView.getUint8(offset++));
        }
        return str;
    }

    // Read Header
    const header = readString(10);
    if (header !== 'ARFL002DZT') {
        throw new Error('Invalid file header.');
    }

    // Read Dimensions: ni, nj, ntime
    const ni = dataView.getUint32(offset, true); offset += 4;
    const nj = dataView.getUint32(offset, true); offset += 4;
    const ntime = dataView.getUint32(offset, true); offset += 4;

    // Read Timestamps
    const tlist = [];
    for (let i = 0; i < ntime; i++) {
        const timestamp = Number(dataView.getBigUint64(offset, true)); offset += 8;
        const date = new Date(timestamp * 1000); // Assuming timestamp is in seconds
        tlist.push(date.toISOString());
    }

    // Define Quantization Type Mapping (Updated)
    const quant_type_mapping = {
        0: 'int8',
        1: 'int16',
        2: 'int32',
        3: 'float32',
        4: 'float16',
        5: 'logInt8'
    };

    const variables = {};

    // Read Variables
    while (offset < arraybuffer.byteLength) {
        // Read Variable Name Length
        const nchar = dataView.getUint8(offset++);

        // Read Variable Name
        const name = readString(nchar);

        // Read Quantization Type Code
        const quant_type_code = dataView.getUint8(offset++);
        const quant_type = quant_type_mapping[quant_type_code];
        if (quant_type === undefined) {
            throw new Error(`Unsupported quantization type code: ${quant_type_code}`);
        }

        // Read Number of Dimensions (ndim)
        const ndim = dataView.getUint8(offset++);

        // Read Shape
        const shape = [];
        for (let i = 0; i < ndim; i++) {
            const dim_size = dataView.getUint32(offset, true); offset += 4;
            shape.push(dim_size);
        }

        // Read Bounds: min_val, max_val
        const min_val = dataView.getFloat32(offset, true); offset += 4;
        const max_val = dataView.getFloat32(offset, true); offset += 4;

        // Calculate Total Elements
        const total_elements = shape.reduce((a, b) => a * b, 1);

        // Read Data Based on Quantization Type
        let data = [];
        switch (quant_type) {
            case 'int8':
                {
                    const int8Array = new Int8Array(arraybuffer, offset, total_elements);
                    data = Array.from(int8Array).map(v => (v / 127) * (max_val - min_val) + min_val);
                    offset += total_elements;
                }
                break;
            case 'int16':
                {
                    const int16Array = new Int16Array(arraybuffer, offset, total_elements);
                    data = Array.from(int16Array).map(v => (v / 32767) * (max_val - min_val) + min_val);
                    offset += total_elements * 2;
                }
                break;
            case 'int32':
                {
                    const int32Array = new Int32Array(arraybuffer, offset, total_elements);
                    data = Array.from(int32Array).map(v => (v / 2147483647) * (max_val - min_val) + min_val);
                    offset += total_elements * 4;
                }
                break;
            case 'float32':
                {
                    const float32Array = new Float32Array(arraybuffer, offset, total_elements);
                    data = Array.from(float32Array);
                    offset += total_elements * 4;
                }
                break;
            case 'float16':
                {
                    data = [];
                    for (let i = 0; i < total_elements; i++) {
                        const bits = dataView.getUint16(offset, true); offset += 2;
                        data.push(float16ToFloat32(bits));
                    }
                }
                break;
            case 'logInt8':
                {
                    const logInt8Array = new Int8Array(arraybuffer, offset, total_elements);
                    data = Array.from(logInt8Array).map(v => {
                        const log_data = v / 127 + min_val;
                        return Math.expm1(Math.abs(log_data)) * Math.sign(log_data);
                    });
                    offset += total_elements;
                }
                break;
            default:
                throw new Error(`Unhandled quantization type: ${quant_type}`);
        }

        // Reshape Data
        if (shape.length > 1) {
            data = reshape(data, shape);
        }

        // Assign Data to Variables
        if (!variables[name]) {
            if (name === 'U' || name === 'V') {
                variables[name] = [];
            } else {
                variables[name] = data;
            }
        }
        if (name === 'U' || name === 'V') {
            variables[name].push(data);
        }
    }

    // Construct Value Bounds
    const value_bounds = {};
    for (let [key, varData] of Object.entries(variables)) {
        if (key === 'altitude') {
            const min = Math.min(...varData.flat());
            const max = Math.max(...varData.flat());
            value_bounds[key] = [min, max];
        } else if (key === 'U' || key === 'V') {
            const allData = varData.flat();
            const min = Math.min(...allData);
            const max = Math.max(...allData);
            value_bounds[key] = [min, max];
        }
    }

    // Construct JSON Structure
    const json_structure = {
        "value_bounds": value_bounds,
        "dimension": {
            "ni": ni,
            "nj": nj,
            "ntime": ntime
        },
        "altitude": variables['altitude'],
        "data": {},
        "BBox": {} // Placeholder: Replace with actual bounds if available
    };

    // Populate Data for Each Time Frame
    for (let i = 0; i < ntime; i++) {
        const tf = tlist[i];
        json_structure["data"][tf] = {
            "U": variables['U'][i],
            "V": variables['V'][i]
        };
    }

    return json_structure;
}

/**
 * Example usage of bin2Json with JSZip.
 */
function fetchAndDeserializeData(dataFileUrl) {
    fetch(dataFileUrl)
        .then(response => {
            if (!response.ok) {
                throw new Error('Network response was not ok.');
            }
            return response.blob();
        })
        .then(blob => JSZip.loadAsync(blob))
        .then(zip => {
            // Replace 'data.bin' with the actual name of your binary file inside the ZIP
            return zip.file('data.bin').async('arraybuffer');
        })
        .then(arraybuffer => {
            // Deserialize the binary data
            const deserializedData = bin2Json(arraybuffer);
            console.log(deserializedData);
            // Assign to your desired property, e.g., this.data2D = deserializedData;
        })
        .catch(error => {
            console.error('Error fetching or deserializing data:', error);
        });
}

function transformLatLonToPoint(lat, lon, bbox, origin, extents) {
    const scaleX = extents.width / (bbox.E - bbox.W);
    const scaleY = extents.height / (bbox.N - bbox.S);

    const x = origin.x + (lon - bbox.W) * scaleX;
    const y = origin.y + (bbox.N - lat) * scaleY; // Subtract from N to invert the Y axis

    return { x, y };
}

function formatDateForPath(date) {
    return date.toISOString()
               .replace(/:\d\d\.\d+Z$/, '') // Removes seconds fraction and Z
               .replace(/:/g, '-') // Replaces remaining colons with hyphens
               .replace('T', '_'); // Replaces T with underscore
}

function formatDateForDateParam(date) {
    return date.toISOString().replace(/\.\d+Z$/, 'Z');
}

function transformPointToLatLon(x, y, bbox, origin, extents) {
    const scaleX = extents.width / (bbox.E - bbox.W);
    const scaleY = extents.height / (bbox.N - bbox.S);
    const lon = ((x - origin.x) / scaleX) + bbox.W;
    const lat = bbox.N - ((y - origin.y) / scaleY);
    return { lat, lon };
}

function encodeCoordinate(lat, lng) {
    let encode = (value) => {
        let encoded = '';
        let v = Math.floor(value < 0 ? ~(value << 1) : (value << 1));
        while (v >= 0x20) {
            encoded += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
            v >>= 5;
        }
        encoded += String.fromCharCode(v + 63);
        return encoded;
    };
    let latCode = encode(Math.round(lat * 1e5));
    let lngCode = encode(Math.round(lng * 1e5));
    return latCode + lngCode;
}

function getDateTimeString(timeInMilliseconds) {
    
    const date = new Date(timeInMilliseconds);
    // Extract the day, month, year, hours, and minutes
    const day = date.getDate();
    const month = date.getMonth() + 1; // getMonth() returns 0-11
    const year = date.getFullYear();
    const hours = date.getHours();
    const minutes = date.getMinutes();

    const dateString = day + '/' + month + '/' + year;
    const timeString = (hours < 10 ? '0' : '') + hours + ':' + (minutes < 10 ? '0' : '') + minutes;

    const dateTimeString = dateString + ' ' + timeString;
    return dateTimeString;
}

function interpolateAt(s_field, x, y,timeIndex1, timeIndex2, rIndices) {

    const { origin, extents, altitude } = s_field;


    const { U: U1, V: V1 } = s_field.data[timeIndex1];
    const { U: U2, V: V2 } = s_field.data[timeIndex2];

    const fx = ((x - origin.x) / extents.width) * (altitude.length - 1);
    const fy = ((y - origin.y) / extents.height) * (altitude[0].length - 1);
    const ix1 = Math.floor(fx);
    const iy1 = Math.floor(fy);
    const ix2 = Math.min(ix1 + 1, altitude.length - 1);
    const iy2 = Math.min(iy1 + 1, altitude[0].length - 1);
    const fracX = fx - ix1;
    const fracY = fy - iy1;
    
    if (ix1 < 0 || ix1 > altitude.length - 1 ||
        ix2 < 0 || ix2 > altitude.length - 1 ||
        iy1 < 0 || iy1 > altitude[0].length - 1 ||
        iy2 < 0 || iy2 > altitude[0].length - 1) {
        return { z: 0, y: 0, x: 0 };
    }
    // Inline bilinear interpolation
    const interpolate = (matrix) => 
        (1 - fracX) * ((1 - fracY) * matrix[ix1][iy1] + fracY * matrix[ix1][iy2]) +
        fracX * ((1 - fracY) * matrix[ix2][iy1] + fracY * matrix[ix2][iy2]);

    return {
        z: interpolate(altitude),
        u: interpolate(U1)*rIndices+interpolate(U2)*(1-rIndices),
        v: interpolate(V1)*rIndices+interpolate(V2)*(1-rIndices)
    };
} 
function interpolateRunoffAt(s_field, x, y, timeIndex) {
    // Destructuring to get origin, extents, and altitude
    const { origin, extents, altitude } = s_field;

    // Calculate indices and fractional parts for interpolation
    const fx = ((x - origin.x) / extents.width) * (altitude.length - 1);
    const fy = ((y - origin.y) / extents.height) * (altitude[0].length - 1);
    const ix1 = Math.floor(fx);
    const iy1 = Math.floor(fy);
    const ix2 = Math.min(ix1 + 1, altitude.length - 1);
    const iy2 = Math.min(iy1 + 1, altitude[0].length - 1);
    const fracX = fx - ix1;
    const fracY = fy - iy1;

    if (ix1 < 0 || ix2 >= altitude.length || iy1 < 0 || iy2 >= altitude[0].length) {
        return { z: 0, steepestSlopeU: 0, steepestSlopeV: 0 };
    }

    // Inline bilinear interpolation for altitude
    const interpolateAltitude = (matrix) =>
        (1 - fracX) * ((1 - fracY) * matrix[ix1][iy1] + fracY * matrix[ix1][iy2]) +
        fracX * ((1 - fracY) * matrix[ix2][iy1] + fracY * matrix[ix2][iy2]);

    // Calculate the altitude at the given x, y
    const alt = interpolateAltitude(altitude);

    // Calculate gradients in the x and y directions
    const dzdx = 10*(altitude[ix2][iy1] - altitude[ix1][iy1]) / (extents.width / (altitude.length - 1));
    const dzdy = 10*(altitude[ix1][iy2] - altitude[ix1][iy1]) / (extents.height / (altitude[0].length - 1));

    return { z:alt, u: -dzdx, v: -dzdy };
}