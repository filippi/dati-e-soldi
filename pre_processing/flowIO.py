import numpy as np
import struct
import io
import zipfile
from datetime import datetime



def arrayTo2DTBIN(altitude, u, v, tlist, filename=None, temp=None, ffmc=None, bounds=None):
    """
    Serializes the given arrays and metadata into a binary format.

    Parameters:
    - altitude (np.ndarray): 2D array of altitude values.
    - u (np.ndarray): 3D array of U component values.
    - v (np.ndarray): 3D array of V component values.
    - tlist (list of datetime): List of timestamps.
    - filename (str, optional): If provided, the binary data is compressed into a ZIP file with this name.
    - temp, ffmc: Additional parameters (not used in this implementation).
    - bounds (dict, optional): Bounding box information.

    Returns:
    - bytes or None: The serialized binary data if filename is not provided; otherwise, None.
    """
    ni, nj = altitude.shape
    ntime = len(tlist)

    # Initialize a binary buffer
    buffer = io.BytesIO()

    # 1. Header
    header = b"ARFL002DZT"
    buffer.write(header)

    # 2. Dimensions
    buffer.write(struct.pack('<I', ni))  # Little-endian unsigned int
    buffer.write(struct.pack('<I', nj))
    buffer.write(struct.pack('<I', ntime))

    # 3. Timestamps
    for dt in tlist:
        # Convert datetime to UNIX timestamp (int64)
        print(dt)
        timestamp = int(dt)
        buffer.write(struct.pack('<Q', timestamp))  # Little-endian unsigned long long

    # Define Quantization Type Mapping (Removed 'int4')
    quant_type_mapping = {
        0: 'int8',
        1: 'int16',
        2: 'int32',
        3: 'float32',
        4: 'float16',
        5: 'logInt8'
    }

    # Helper function to serialize a variable
    def serialize_variable(name, data, quant_type_code):
        """
        Serializes a single variable into the buffer.

        Parameters:
        - name (str): Name of the variable.
        - data (np.ndarray): Data array (can be multi-dimensional).
        - quant_type_code (int): Quantization type code (0-5).
        """
        if quant_type_code not in quant_type_mapping:
            raise ValueError(f"Unsupported quantization type code: {quant_type_code}")

        quant_type = quant_type_mapping[quant_type_code]

        # 4a. Variable Name
        name_bytes = name.encode('utf-8')
        nchar = len(name_bytes)
        if nchar > 254:
            raise ValueError(f"Variable name '{name}' exceeds 254 characters.")
        buffer.write(struct.pack('<B', nchar))  # Unsigned char for number of characters
        buffer.write(name_bytes)

        # 4b. Quantization Type Code
        buffer.write(struct.pack('<B', quant_type_code))  # Unsigned char for quant_type

        # 4c. Shape Information
        ndim = len(data.shape)
        buffer.write(struct.pack('<B', ndim))  # Unsigned char for number of dimensions
        for dim_size in data.shape:
            buffer.write(struct.pack('<I', dim_size))  # Unsigned int for each dimension size

        # 4d. Bounds
        min_val = float(np.min(data))
        max_val = float(np.max(data))
        buffer.write(struct.pack('<f', min_val))
        buffer.write(struct.pack('<f', max_val))

        # 4e. Data Serialization based on quant_type
        if quant_type == 'int8':
            # Scale data to int8
            scale = 127 / (max_val - min_val) if max_val != min_val else 1
            quantized = ((data - min_val) * scale).astype(np.int8)
            buffer.write(quantized.tobytes())
        elif quant_type == 'int16':
            # Scale data to int16
            scale = 32767 / (max_val - min_val) if max_val != min_val else 1
            quantized = ((data - min_val) * scale).astype(np.int16)
            buffer.write(quantized.tobytes())
        elif quant_type == 'int32':
            # Scale data to int32
            scale = 2147483647 / (max_val - min_val) if max_val != min_val else 1
            quantized = ((data - min_val) * scale).astype(np.int32)
            buffer.write(quantized.tobytes())
        elif quant_type == 'float32':
            # Directly store as float32
            quantized = data.astype(np.float32)
            buffer.write(quantized.tobytes())
        elif quant_type == 'float16':
            # Directly store as float16
            quantized = data.astype(np.float16)
            buffer.write(quantized.tobytes())
        elif quant_type == 'logInt8':
            # Apply logarithmic scaling before quantizing to int8
            with np.errstate(divide='ignore'):
                log_data = np.log1p(np.abs(data)) * np.sign(data)  # Preserve sign
            min_log = float(np.min(log_data))
            max_log = float(np.max(log_data))
            scale = 127 / (max_log - min_log) if max_log != min_log else 1
            quantized = (log_data - min_log) * scale
            quantized = quantized.astype(np.int8)
            buffer.write(quantized.tobytes())
        else:
            raise ValueError(f"Unhandled quantization type: {quant_type}")

    # 5. Serialize 'altitude'
    serialize_variable('altitude', altitude, quant_type_code=1)  # int16

    # 6. Serialize 'U' and 'V' with fliplr
    for var_name, var_data, q_type in [('U', u, 0), ('V', v, 0)]:  # int8
        # Assuming u and v are 3D arrays: [time, ni, nj]
        # Serialize each time slice
        for t in range(ntime):
            flipped_data = np.fliplr(var_data[t])
            serialize_variable(var_name, flipped_data, quant_type_code=q_type)

    # 7. Get the binary data
    binary_data = buffer.getvalue()

    # 8. Optionally compress into a ZIP file
    if filename:
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
            zip_file.writestr('data.bin', binary_data)
        with open(filename, 'wb') as f:
            f.write(zip_buffer.getvalue())
        return None  # Data is written to file
    else:
        return binary_data

def read_variable(file_descriptor):
    """
    Deserializes a single variable from the binary data.

    Parameters:
    - file_descriptor (file-like object): Opened in binary mode, positioned at the start of a variable.

    Returns:
    - dict: A dictionary containing variable metadata and data.
      {
          'name': str,
          'quant_type': str,
          'shape': tuple,
          'min': float,
          'max': float,
          'data': np.ndarray
      }
    """
    quant_type_mapping = {
        0: 'int8',
        1: 'int16',
        2: 'int32',
        3: 'float32',
        4: 'float16',
        5: 'logInt8'
    }

    # 1. Read Variable Name
    nchar_bytes = file_descriptor.read(1)
    if not nchar_bytes:
        return None  # End of file
    nchar = struct.unpack('<B', nchar_bytes)[0]
    name_bytes = file_descriptor.read(nchar)
    name = name_bytes.decode('utf-8')

    # 2. Read Quantization Type Code
    quant_type_code_bytes = file_descriptor.read(1)
    quant_type_code = struct.unpack('<B', quant_type_code_bytes)[0]
    if quant_type_code not in quant_type_mapping:
        raise ValueError(f"Unsupported quantization type code: {quant_type_code}")
    quant_type = quant_type_mapping[quant_type_code]

    # 3. Read Shape Information
    ndim_bytes = file_descriptor.read(1)
    ndim = struct.unpack('<B', ndim_bytes)[0]
    shape = []
    for _ in range(ndim):
        dim_size_bytes = file_descriptor.read(4)
        dim_size = struct.unpack('<I', dim_size_bytes)[0]
        shape.append(dim_size)
    shape = tuple(shape)

    # 4. Read Bounds
    min_val_bytes = file_descriptor.read(4)
    min_val = struct.unpack('<f', min_val_bytes)[0]
    max_val_bytes = file_descriptor.read(4)
    max_val = struct.unpack('<f', max_val_bytes)[0]

    # 5. Read Data
    total_elements = np.prod(shape)
    if quant_type == 'int8':
        data_bytes = file_descriptor.read(total_elements)
        quantized = np.frombuffer(data_bytes, dtype=np.int8)
        data = quantized.astype(np.float32) / 127 * (max_val - min_val) + min_val
    elif quant_type == 'int16':
        data_bytes = file_descriptor.read(total_elements * 2)
        quantized = np.frombuffer(data_bytes, dtype='<i2')  # Little-endian int16
        data = quantized.astype(np.float32) / 32767 * (max_val - min_val) + min_val
    elif quant_type == 'int32':
        data_bytes = file_descriptor.read(total_elements * 4)
        quantized = np.frombuffer(data_bytes, dtype='<i4')  # Little-endian int32
        data = quantized.astype(np.float32) / 2147483647 * (max_val - min_val) + min_val
    elif quant_type == 'float32':
        data_bytes = file_descriptor.read(total_elements * 4)
        data = np.frombuffer(data_bytes, dtype='<f4').reshape(shape)
    elif quant_type == 'float16':
        data_bytes = file_descriptor.read(total_elements * 2)
        data = np.frombuffer(data_bytes, dtype='<f2').astype(np.float32).reshape(shape)
    elif quant_type == 'logInt8':
        data_bytes = file_descriptor.read(total_elements)
        quantized = np.frombuffer(data_bytes, dtype=np.int8)
        log_data = quantized.astype(np.float32) / 127 + min_val
        data = np.expm1(np.abs(log_data)) * np.sign(log_data)
    else:
        raise ValueError(f"Unhandled quantization type: {quant_type}")

    # Reshape data
    if quant_type not in ['float32', 'float16']:
        data = data.reshape(shape)
    else:
        data = data.reshape(shape)

    return {
        'name': name,
        'quant_type': quant_type,
        'shape': shape,
        'min': min_val,
        'max': max_val,
        'data': data
    }

def read_all_variables(zip_filename):
    """
    Reads all variables from the binary data stored in a ZIP file.

    Parameters:
    - zip_filename (str): Path to the ZIP file containing 'data.bin'.

    Returns:
    - dict: A dictionary containing all variables.
      {
          'altitude': np.ndarray,
          'U': list of np.ndarray (per time slice),
          'V': list of np.ndarray (per time slice)
      }
    """
    variables = {}
    with zipfile.ZipFile(zip_filename, 'r') as zip_file:
        with zip_file.open('data.bin') as data_file:
            # Read Header
            header = data_file.read(10)
            if header != b"ARFL002DZT":
                raise ValueError("Invalid file header.")

            # Read Dimensions
            ni, = struct.unpack('<I', data_file.read(4))
            nj, = struct.unpack('<I', data_file.read(4))
            ntime, = struct.unpack('<I', data_file.read(4))

            # Read Timestamps
            tlist = []
            for _ in range(ntime):
                timestamp, = struct.unpack('<Q', data_file.read(8))
                dt = datetime.fromtimestamp(timestamp)
                tlist.append(dt)

            # Read Variables
            while True:
                var = read_variable(data_file)
                if var is None:
                    break  # End of file
                name = var['name']
                data = var['data']
                if name not in variables:
                    if name in ['U', 'V']:
                        variables[name] = []
                    else:
                        variables[name] = data
                if name in ['U', 'V']:
                    variables[name].append(data)

    return {
        'value_bounds': {},  # Populate as needed
        'dimension': {
            'ni': ni,
            'nj': nj,
            'ntime': ntime
        },
        'altitude': limit_float_precision(variables.get('altitude')),
        'data': {
            'tlist': [dt.isoformat() for dt in tlist],
            'U': [limit_float_precision(u_slice) for u_slice in variables.get('U', [])],
            'V': [limit_float_precision(v_slice) for v_slice in variables.get('V', [])]
        },
        'BBox': bounds
    }

# Example Usage
if __name__ == "__main__":
    import numpy as np
    from datetime import datetime, timedelta

    # Sample data
    ni, nj, ntime = 100, 100, 10
    altitude = np.random.uniform(1000, 5000, size=(ni, nj)).astype(np.float32)
    u = np.random.uniform(-10, 10, size=(ntime, ni, nj)).astype(np.float32)
    v = np.random.uniform(-10, 10, size=(ntime, ni, nj)).astype(np.float32)
    tlist = [datetime.now() + timedelta(hours=i) for i in range(ntime)]
    bounds = {"xmin": 0, "xmax": ni, "ymin": 0, "ymax": nj}

    # Serialize to binary and save to ZIP
    arrayTo2DTBIN(altitude, u, v, tlist, filename="data.zip", bounds=bounds)

    # Deserialize from ZIP
    deserialized_data = read_all_variables("data.zip")
    print(deserialized_data)
