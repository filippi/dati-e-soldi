import json
import math

import cfgrib
import vtk
import xarray as xr
import zipfile
import io
import numpy as np 
from flowIO import arrayTo2DTBIN

def limit_float_precision(obj):
    if isinstance(obj, float):
        return round(obj, 2)
    elif isinstance(obj, dict):
        return {k: limit_float_precision(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [limit_float_precision(x) for x in obj]
    return obj

class CustomEncoder(json.JSONEncoder):
    def iterencode(self, o, _one_shot=False):
        if isinstance(o, float):
            return format(o, '.2f')
        return super(CustomEncoder, self).iterencode(o, _one_shot)
   


def arrayTo2DTJSON(altitude, u, v,  tlist, filename="None",temp=None,ffmc=None,bounds=None):
    ni, nj = np.shape(altitude)
    json_structure = {

      
        "value_bounds": {
            "U":limit_float_precision((float(np.min(u)),float(np.max(u)))),
            "V":limit_float_precision((float(np.min(v)),float(np.max(v)))),
            "altitude":limit_float_precision((float(np.min(altitude)),float(np.max(altitude))))
            },
  
        "dimension": {
            "ni": ni,
            "nj": nj
        },
        "altitude": limit_float_precision(altitude.tolist()),
        
        "data": {},
        "BBox": bounds
    }
    
    # Adding time frames data to JSON structure
    for i, tf in enumerate(tlist):
        json_structure["data"][str(tf)] = {
            "U": limit_float_precision(np.fliplr(u[i]).tolist()),
            "V": limit_float_precision(np.fliplr(v[i]).tolist())
        }
    # Convert to JSON string
    # Assuming CustomEncoder is defined elsewhere
    json_string = json.dumps(json_structure, cls=CustomEncoder, separators=(',', ':'))
    
    # Check if filename is not 'None'
    if filename != "None":    
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, 'a', zipfile.ZIP_DEFLATED, False) as zip_file:
            zip_file.writestr('data.json', json_string)
        
        # Write the ZIP file to disk
        with open(filename, 'wb') as f:
            f.write(zip_buffer.getvalue())
    return json_structure

def read_vtk_file(file_path):
    reader = vtk.vtkXMLStructuredGridReader()
    reader.SetFileName(file_path)
    reader.Update()

    # Extracting data from the reader
    data = reader.GetOutput()

    return data

def getShape(vtk_data):
    # Get extents
    extents = vtk_data.GetExtent()
 
    # Calculate the shape
    NI = extents[1] - extents[0] + 1
    NJ = extents[3] - extents[2] + 1
    NK = extents[5] - extents[4] + 1
   
    # Get origin
    origin = vtk_data.GetPoint(0)

    # Calculate bounds
    left_point_coords = vtk_data.GetPoint(vtk_data.FindPoint(extents[0], extents[2], extents[4]))
    right_point_coords = vtk_data.GetPoint(vtk_data.FindPoint(extents[1], extents[2], extents[4]))
    bottom_point_coords = vtk_data.GetPoint(vtk_data.FindPoint(extents[0], extents[2], extents[4]))
    top_point_coords = vtk_data.GetPoint(vtk_data.FindPoint(extents[0], extents[3], extents[4]))
  
    # Create the dictionary
    shape_dict = {
        "shape": (NI, NJ, NK),
        "origin": origin,
        "bounds": {
            "top": top_point_coords[1],
            "bottom": origin[1],
            "left": origin[0],
            "right": right_point_coords[0]
        }
    }

    return shape_dict




def extract_last_number(filepath):
    import re

    # Extraire le nom de base du fichier (sans le chemin)
    base = os.path.basename(filepath)
    
    # Utiliser une expression régulière pour trouver tous les nombres dans le nom de fichier
    numbers = re.findall(r'\d+', base)
    
    # Renvoyer le dernier nombre trouvé, converti en entier
    return int(numbers[-1]) if numbers else 0

import glob,os
from datetime import datetime, timedelta
#str(ds.time.data[0])
import pandas as pd

def FFMNHVTKtoTimedArraync():
    VTKINPUTPATTERN = "/Users/filippi_j/data/2024/barbaggio/MNHfields/output.full.*.vts"
    
    refTimeString = "2024-01-03T00:00:00.000000000" 
    contours1  = glob.glob(VTKINPUTPATTERN)
    
    selectionSorted =  sorted(contours1, key=extract_last_number)[::20]
    
    refTime = datetime.fromisoformat(refTimeString[:26])
    
    filetimes = [refTime + timedelta(seconds=extract_last_number(filePath)) for filePath in selectionSorted]
    time_index = pd.to_datetime(filetimes)
    
    vtk_data = read_vtk_file(selectionSorted[0])
    shape_info = getShape(vtk_data)
    NI, NJ, NK = shape_info["shape"]
    # Create DataArrays
    dims = ('time', 'NI', 'NJ')
    coords = {'time': time_index, 'NI': range(NI), 'NJ': range(NJ)}
    XarrayU = xr.DataArray(name="U", dims=dims, coords=coords)
    XarrayV = xr.DataArray(name="V", dims=dims, coords=coords)
    XarrayW = xr.DataArray(name="W", dims=dims, coords=coords)
    XarrayTKE = xr.DataArray(name="TKE", dims=dims, coords=coords)
    
    
    
    for filePath, filetime in zip(selectionSorted, filetimes):
        seconds = extract_last_number(filePath)
        filetime = refTime + timedelta(seconds=seconds)
        
        vtk_data = read_vtk_file(filePath)
        shape_info = getShape(vtk_data)
        NI, NJ, NK = shape_info["shape"]
    
        UVW = vtk_to_numpy(vtk_data.GetPointData().GetArray("Wind"))
        U = np.reshape(UVW[:,0], (NK, NJ, NI))[0,:,:]
        V = np.reshape(UVW[:,1], (NK, NJ, NI))[0,:,:]
        W = np.reshape(UVW[:,2], (NK, NJ, NI))[0,:,:]
        TKE = np.reshape(vtk_to_numpy(vtk_data.GetPointData().GetArray("TKE")), (NK, NJ, NI))[0,:,:]
    
        XarrayU.loc[filetime, :, :] = U
        XarrayV.loc[filetime, :, :] = V
        XarrayW.loc[filetime, :, :] = W
        XarrayTKE.loc[filetime, :, :] = TKE
    
    # Combine into a single dataset
    ds = xr.Dataset({'U': XarrayU, 'V': XarrayV, 'W': XarrayW, 'TKE': XarrayTKE})
    
    # Save dataset
    ds.to_netcdf('/Users/filippi_j/data/2024/barbaggio/MNHfields/compilX.nc')
    return ds


        



def oneSubsetVtkFiletodata(filePath= "/Users/filippi_j/data/2023/prunelli/ARexperience/20200809/test/test_0.vts"):
    vtk_data = read_vtk_file(filePath)
    shape_info = getShape(vtk_data)
    NI, NJ, NK = shape_info["shape"]
    
    altitude_array = np.flipud(np.rot90(np.reshape(vtk_to_numpy(vtk_data.GetPointData().GetArray("altitude")), (NI, NJ))))
    U_array = np.flipud(np.rot90(np.reshape(vtk_to_numpy(vtk_data.GetPointData().GetArray("U")), (NI, NJ))))
    V_array = np.flipud(np.rot90(np.reshape(vtk_to_numpy(vtk_data.GetPointData().GetArray("V")), (NI, NJ))))
    
    
    
    origin = (shape_info["origin"][0] ,shape_info["origin"][1])
    extent = ( shape_info["bounds"]["right"] - shape_info["bounds"]["left"], shape_info["bounds"]["top"] - shape_info["bounds"]["bottom"])
    
    print(origin, extent)
    json_data = arrayTo2DJSON(altitude_array, U_array, V_array, origin, extent)#,filename = "/Users/filippi_j/Volumes/firecaster/www/arfields/data.zip")

    dataset_path = "/Users/filippi_j/data/2023/prunelli/prunelli15020200809_l0_UVWTKE5000063000.nc"
    ds = xr.open_dataset(dataset_path)
    fakeA = ds.altitude * 0.001


    
    # Determine start and end times if not provided
    start_time = ds['time'].data.min()
    end_time = ds['time'].data.max()
    sliceT = 24
    RR=altitude_array[:-1,:-1]
    
    arrayTo2DTJSON(RR, tt(ds.U[::sliceT,:,:].data), tt(ds.V[::sliceT,:,:].data), origin, extent, range(0,3600*24,3600*2), filename="/Users/filippi_j/soft/firefront/tools/AR/timed.zip")

def medseaData(filePath= "/Users/filippi_j/data/2023/oursins/MEDSEA2019.nc"):
    ds = xr.open_dataset(filePath)
    arrayTo2DTJSON(np.ones((1016, 380))*0, rr(ds.uo[:,0,:,:]*10), rr(ds.vo[:,0,:,:]*10), [0,0], [10.15,5.685], range(0,3600*24,3600*2), filename="/Users/filippi_j/soft/firefront/tools/AR/timed.zip")

def tt(A):
    B = np.empty_like(A)
    for i in range(A.shape[0]):
        B[i] = np.flipud(np.rot90(A[i]))
    return B

def rr(A,tkey='time', lonkey='lon', latkey='lat'):
    tX = A.fillna(0)
    tX = tX.transpose(tkey, lonkey, latkey)
    
    return tX.data

def menorData(infilePath="/Users/filippi_j/data/2023/oursins/champs_meno_BE201905.nc",altBinOut='/Users/filippi_j/soft/ARflow/med_currents_AR/elevation.bin',jsonZipBinOut="/Users/filippi_j/soft/ARflow/med_currents_AR/stimed.zip"):
    ds = xr.open_dataset(infilePath)
    
    elevation = ds.H0.data
    
    resolution = 1200
    floorValue = np.nanmax(elevation).astype(np.uint16)
    

    
    array_uint16 = floorValue-(np.flipud(np.abs(elevation).astype(np.uint16)))
    print(np.max(array_uint16),np.min(array_uint16))
    with open(altBinOut, 'wb') as file:
        array_uint16.tofile(file)
       
    
    sliceT = 32
    tlist = list((ds.time[::sliceT].data.astype(int)/1000000).astype(int))
    print("timeOK")
    U = rr(ds.UZ[::sliceT,-2,:,:],"time","ni_u","nj_u")
    shapeU = np.shape(U)
    V = rr(ds.VZ[::sliceT,-2,:,:],"time","ni_v","nj_v")
    print("VOK",np.max(V),np.min(V))

    Z0 = np.ones( shapeU[1:])*floorValue

  
    
    
    return arrayTo2DTJSON( Z0, U, -V, resolution, tlist, filename=jsonZipBinOut)
     
def compilMNH2Json():          
    infilePath="/Users/filippi_j/data/2024/barbaggio/MNHfields/FCAST.3.FIRE.001.nc"
    flowfilePath="/Users/filippi_j/data/2024/barbaggio/MNHfields/compil.nc"
    altBinOut='/Users/filippi_j/soft/ARflow/wind_barbaggio_AR/bbelevation.bin'
    jsonZipBinOut="/Users/filippi_j/soft/ARflow/wind_barbaggio_AR/bbtimed2.zip"
    
    dsX = FFMNHVTKtoTimedArraync()
    
    land = xr.open_dataset(infilePath)   
    ds = xr.open_dataset(flowfilePath) 
    elevation = land.ZS.data[1:,1:]
    resolution = 80
    floorValue = np.nanmax(elevation).astype(np.uint16)
    
        
    array_uint16 = np.flipud(np.abs(elevation).astype(np.uint16))
                             
    print(np.max(array_uint16),np.min(array_uint16))
    with open(altBinOut, 'wb') as file:
        array_uint16.tofile(file)
       
    
    sliceT = 1
    tlist = list((ds.time[::sliceT].data.astype(int)/1000000).astype(int))
    
    
    RDU = ds.U[::sliceT,:,:] 
    RDV = ds.V[::sliceT,:,:]
    RDTKE = ds.TKE[::sliceT,:,:]
    
   # RDU[:] = dsX.U[0,:,:] 
   # RDV[:] = dsX.V[0,:,:] 
   # RDTKE[:] = dsX.TKE[0,:,:] 
    
    RDU[0].plot()
    TKE = rr(RDTKE,"time","NJ","NI")
    U = rr(RDU,"time","NJ","NI")  
    V = rr(RDV,"time","NJ","NI") 
    
    shapeU = np.shape(U)
    
    #TKE = rr(ds.U[::sliceT,:,:],"time","NI","NJ")
    #U = rr(ds.U[::sliceT,:,:],"time","NI","NJ")  
    #V = rr(ds.V[::sliceT,:,:],"time","NI","NJ") 
    
    
    print("VOK",np.max(V),np.min(V))
    
    Z0 = array_uint16
    
    print("UOK",np.shape(Z0), shapeU)
    altBin=np.flipud(np.rot90(array_uint16.astype(np.float32)))
    
    print("SHOPA Uint",np.shape(altBin), shapeU, np.min(Z0),np.max(Z0),np.min(altBin),np.max(altBin))
    
    A = arrayTo2DTJSON( altBin+10, U, -V, resolution, tlist, filename=jsonZipBinOut)
    
    

#2 - get the background image and add watermark

from PIL import Image, ImageDraw, ImageFont
import numpy as np
# Charger l'image

import geopandas as gpd
import contextily as cx
import pycrs
import xarray as xr  
from fiona.crs import from_epsg 
from rasterio.mask import mask
from shapely.geometry import box
import rasterio

def read_hdr(filenamehdr):
    """ Lire le fichier .hdr et extraire les métadonnées """
    metadata = {}
    with open(filenamehdr, 'r') as file:
        for line in file:
            parts = line.strip().split(': ')
            if len(parts) == 2:
                key, value = parts
                metadata[key] = value
    return metadata

def dirHDRtoXarray(filenamedir, filenamehdr, replaceNoDataValue=None):
    """ Charger un fichier .dir en tant que xarray.DataArray """
    metadata = read_hdr(filenamehdr)
    print(metadata)
    rows = int(metadata['rows'])
    cols = int(metadata['cols'])
    data_type = np.int16  # Modifiez cela en fonction du type de données spécifié dans le .hdr

    data = np.fromfile(filenamedir, dtype=data_type).reshape((rows, cols))
    data = np.flipud(data)

    # Remplacer les valeurs 'nodata' si spécifié
    if replaceNoDataValue is not None and 'nodata' in metadata:
        nodata_value = int(metadata['nodata'])
        print("Handling nodata as",nodata_value,replaceNoDataValue )
        data[data == nodata_value] = replaceNoDataValue

    # Créer des coordonnées (exemple simple, ajustez selon vos besoins réels)
    lats = np.linspace(float(metadata['south']), float(metadata['north']), rows)
    lons = np.linspace(float(metadata['west']), float(metadata['east']), cols)

    return xr.DataArray(data, coords=[lats, lons], dims=['latitude', 'longitude'])


def webMapsToTif(west, south, east, north, outF, providerSRC, zoomLevel=12):
    tempOUT = outF+"_temp.tif"
    print("extracting ", west, south, east, north, outF)
    
    
    cx.bounds2raster(west, south, east, north ,
                         ll=True,
                         path=tempOUT,
                                         zoom=zoomLevel,
                                         source=providerSRC
     
                        )
    
    
    data = rasterio.open(tempOUT) 
    
    bbox = box(west, south, east, north)
    
    geo = gpd.GeoDataFrame({'geometry': bbox}, index=[0], crs=from_epsg(4326))
    geo = geo.to_crs(crs=data.crs.data)

    coords = [json.loads(geo.to_json())['features'][0]['geometry']]
      
    out_img, out_transform = mask(data, shapes=coords, crop=True)
    epsg_code = int(data.crs.data['init'][5:])
    out_meta = data.meta.copy()
    print(out_meta)
    
    
    out_meta.update({"driver": "GTiff",
                        "height": out_img.shape[1],
                        "width": out_img.shape[2],
                         "transform": out_transform,
                        "crs": pycrs.parse.from_epsg_code(epsg_code).to_proj4()}
                               )
    
    with rasterio.open(outF, "w", **out_meta) as dest:
        dest.write(out_img)

    out_jpeg = outF.replace(".tif", ".jpg")
    with Image.open(outF) as img:
        # Convert RGBA to RGB
        if img.mode == 'RGBA':
            img = img.convert('RGB')
        img.save(out_jpeg, "JPEG", quality=65) 

    print("Saved JPEG:", out_jpeg)
    
    print("Extracted image from contextily bounds:",west, south, east, north," zoom ", zoomLevel, " out files ",outF," and temporary ",tempOUT)



def calculate_dimensions(bounds):
    from geopy.distance import geodesic
    """
    Calculate the width and height in meters for given geographic bounds.

    :param bounds: A dictionary with keys 'W', 'S', 'E', 'N' representing the 
                   west, south, east, and north bounds respectively.
    :return: A dictionary with keys 'width' and 'height' representing the width 
             (east-west distance) and height (north-south distance) in meters.
    """
    # Points for width (West-East)
    west_point = (bounds['S'], bounds['W'])
    east_point = (bounds['S'], bounds['E'])

    # Points for height (South-North)
    south_point = (bounds['S'], bounds['W'])
    north_point = (bounds['N'], bounds['W'])

    # Calculate distances
    width_meters = geodesic(west_point, east_point).meters
    height_meters = geodesic(south_point, north_point).meters

    return {'width': width_meters, 'height': height_meters}




def getDataDict(run_path,searchKey="*.grib2"):
    out_data_files = {}
    sorted_files = sorted(glob.glob(run_path +searchKey))
    print("Files Found : ",sorted_files[0])
    if "grib2" in sorted_files[0]:
        print("Running AROME")
        for file_path in sorted_files:
            basename = os.path.basename(file_path)
            date_str, time_str, delta_str = basename.split('.')[:3]  # Splitting the filename
            delta_hours = int(delta_str.replace('H', ''))  # Extracting the delta hours
        
            # Adjust the format in strptime to match the concatenated string
            datetime_obj = datetime.strptime(date_str + time_str.replace('Z', ''), '%Y%m%d%H') + timedelta(hours=delta_hours)
        
            out_data_files[datetime_obj] = file_path
        return out_data_files
    if "cep" in sorted_files[0]:
        print("Running CEP")
        for file_path in sorted_files:
            ds = cfgrib.open_datasets(file_path, engine='cfgrib')
            dtimeL = pd.to_datetime(ds[0].valid_time.values).to_pydatetime()
            print("Time IS ", dtimeL,ds[0].valid_time.values)
            #ds.close()
            out_data_files[dtimeL] = file_path
        return out_data_files
    print("Running Failed")
    return[]  



def aromeRunToXarrayNC(runPath, bounds , searchKey,ncout_fname=None,):
   
    run_fnames = getDataDict(runPath,searchKey=searchKey)
 
    first = list(run_fnames.keys())[0]
    ds = cfgrib.open_datasets(run_fnames[first], engine='cfgrib')
    print(run_fnames)
    indexu10 = next((i for i, ds in enumerate(ds) if 'u10' in ds.variables), None)
    
    aroSS = ds[indexu10].sel(latitude=slice(bounds['N'], bounds['S']), longitude=slice(bounds['W'], bounds['E']))
    
    print(bounds," for " ,bounds," shape is ",aroSS.u10.shape)
  
    
    times = [pd.Timestamp(t) for t in run_fnames.keys()]
    # Create DataArrays
    coords = {
        'time': times, 
        'latitude': aroSS.latitude.values, 
        'longitude': aroSS.longitude.values
        }
    num_time_steps = len(times)
    u10_expanded = np.repeat(np.expand_dims(aroSS.u10.values, axis=0), num_time_steps, axis=0)
    v10_expanded = np.repeat(np.expand_dims(aroSS.v10.values, axis=0), num_time_steps, axis=0)
    
    # Create DataArrays
    XarrayU = xr.DataArray(u10_expanded, name="U", dims=['time', 'latitude', 'longitude'], coords=coords)
    XarrayV = xr.DataArray(v10_expanded, name="V", dims=['time', 'latitude', 'longitude'], coords=coords)
    
    for ltime in run_fnames.keys():
        print("reading", run_fnames[ltime])
        ds = cfgrib.open_datasets(run_fnames[ltime], engine='cfgrib')
        aroSS = ds[indexu10].sel(latitude=slice(bounds['N'], bounds['S']), longitude=slice(bounds['W'], bounds['E']))
        
        # Find the corresponding time index
        time_index = XarrayU.coords['time'].to_index().get_loc(pd.Timestamp(ltime))
        
        # Assign the data
        XarrayU[time_index] = aroSS.u10
        XarrayV[time_index] = aroSS.v10
        

    ds = xr.Dataset({'U': XarrayU, 'V': XarrayV})
    if ncout_fname != "None":
        ds.to_netcdf(ncout_fname)
    return ds

#aromeRunToXarrayNC(run_path, bounds ,nc_aro_out)

def arome2Json(demXray,  jsonZipBinOut, altBinOut, bounds=None, nc_aro=None, nc_aro_out=None, runPath=None ,searchKey="*.SP1.grib2"):    
    ds = None      
    if nc_aro is not None:
        # Load dataset from netCDF file if nc_aro_out is provided
        ds = xr.open_dataset(nc_aro)
    elif runPath is not None:
        if bounds is not None:
        # Generate dataset using aromeRunToXarrayNC if runPath is provided
            ds = aromeRunToXarrayNC(runPath, bounds, searchKey,ncout_fname=nc_aro_out)
    else:
        # Return or handle the case where neither nc_aro_out nor runPath is provided
        return
    
    aro_bounds = {
        'N': ds.latitude.max().item(),  # Maximum latitude
        'S': ds.latitude.min().item(),  # Minimum latitude
        'E': ds.longitude.max().item(),  # Maximum longitude
        'W': ds.longitude.min().item()   # Minimum longitude
    }
        
    nlat, nlon = ds.U[0].shape
    subsetDEM = demXray.sel(latitude=slice(aro_bounds['S'], aro_bounds['N']), longitude=slice(aro_bounds['W'], aro_bounds['E']))
    new_lat = np.linspace(subsetDEM.latitude.min(), subsetDEM.latitude.max(), nlat)
    new_lon = np.linspace(subsetDEM.longitude.min(), subsetDEM.longitude.max(), nlon)
    subsetDEM_interpolated = subsetDEM.interp(latitude=new_lat, longitude=new_lon)
    aro_d = calculate_dimensions(aro_bounds)
    nlat, nlon = ds.U[0].shape
    dataPointResolutionAlongX = aro_d["width"] / nlon
    dataPointResolutionAlongY = aro_d["height"] / nlat
    
    
    resolution = (dataPointResolutionAlongX+dataPointResolutionAlongY)/2
    array_uint16 = np.flipud(np.abs(subsetDEM_interpolated.data).astype(np.uint16))
    
    nlatHRES, nlonHRES = subsetDEM.shape              
    array_uint16_HD = np.flipud(np.abs(subsetDEM.data*0.9).astype(np.uint16))
    
    
    print(f"dataPointResolutionAlongX: {dataPointResolutionAlongX};\ndataPointResolutionAlongY: {dataPointResolutionAlongY};")
    print(f"demColumns: {nlon};")
    print(f"demLines: {nlat};")
    print(f"dataColumns: {nlon};")
    print(f"dataLines: {nlat};")
    print(f"demMax: {np.max(array_uint16)};")
    
    with open(altBinOut, 'wb') as file:
        array_uint16.tofile(file)
    sliceT = 1
    tlist = list((ds.time[::sliceT].data.astype(int)/1000000).astype(int))
    RDU = ds.U[::sliceT,::-1,:] 
    RDV = ds.V[::sliceT,::-1,:]
    U = rr(RDU,"time","longitude","latitude")  
    V = rr(RDV,"time","longitude","latitude") 
    shapeU = np.shape(U)
    Z0 = array_uint16
    altBin=np.flipud(np.rot90(array_uint16.astype(np.float32)))
    A = arrayTo2DTJSON( altBin+10, U, -V, tlist, filename=jsonZipBinOut,bounds=aro_bounds)
    #B = arrayTo2DTBIN( altBin+10, U, -V, tlist, filename=jsonZipBinOut,bounds=aro_bounds)
    
    return aro_bounds








srtmdirin = '/Users/filippi_j/soft/Meso-NH/PGD/srtm_ne_250.dir'
srtmhdrin = '/Users/filippi_j/soft/Meso-NH/PGD/srtm_ne_250.hdr'
run_path = '/Users/filippi_j/data/2024/20240125/06Z/'
run_path = '/Users/filippi_j/Volumes/dataorsu/AROME/20240416/03Z/'



#srtmdirin = '/Users/filippi_j/soft/Meso-NH/PGD/auDEM.dir'
#srtmhdrin = '/Users/filippi_j/soft/Meso-NH/PGD/auDEM.hdr'
#run_path = '/Users/filippi_j/data/2024/20240125/06Z/'
#run_path = '//Users/filippi_j/data/2024/ballarat/2024022112//'
run_path = '/Users/filippi_j/data/2024/porquerolles/2024060215Z/'
run_path = '/Users/filippi_j/data/2024/liban/20240904/'
run_path = '/Users/filippi_j/data/2024/20241009/'

casename = "Landes"

dataout = f"/Users/filippi_j/soft/ARflow/tile/{casename}.zip"
elevationout = f"/Users/filippi_j/soft/ARflow/tile/{casename}.bin"
BGImageout = f"/Users/filippi_j/soft/ARflow/tile/{casename}.tif"
nc_aro_fname = f"/Users/filippi_j/soft/ARflow/tile/{casename}.nc"

bounds = {}
bounds["porquerolles"]={'W': 5.73,'S': 42.89,'E':6.63,'N':43.60}


bounds["centre"]={'W': 8.4,'S': 41.7,'E':9.65,'N':42.7}
  
bounds["Landes"]={'W': -1.7,'S': 43.5,'E':0.4,'N':45}#{'W': 33.5,'S': 35,'E':37,'N':34.5}
 
gen_background_zoom = 0
gen_from_nc = False

dsDem = dirHDRtoXarray(srtmdirin, srtmhdrin, replaceNoDataValue=0)


if gen_from_nc:
    aro_bounds = arome2Json(dsDem,  dataout, elevationout, bounds = bounds[casename],nc_aro=nc_aro_fname,  nc_aro_out=None, runPath=None )
else:
    aro_bounds = arome2Json(dsDem,  dataout, elevationout, bounds = bounds[casename],nc_aro=None,  nc_aro_out=nc_aro_fname, runPath=run_path ,searchKey="*.SP1.grib2")

#aro_bounds = {'N': -36.04000000000015, 'S': -38.92000000000026, 'E': 146.97000000000045, 'W': 142.02000000000027}
print(aro_bounds)
#aro_bounds=bounds["corte"]
# #aro_bounds = {'N': 42.59000000000255, 'S': 41.900000000002684, 'E': 9.449999999999632, 'W': 8.809999999999645}
# print(aro_bounds)
if gen_background_zoom > 5:
#    webMapsToTif(aro_bounds['W'], aro_bounds['S'], aro_bounds['E'], aro_bounds['N'], BGImageout, providerSRC=cx.providers.OpenStreetMap.Mapnik, zoomLevel=gen_background_zoom)

    webMapsToTif(aro_bounds['W'], aro_bounds['S'], aro_bounds['E'], aro_bounds['N'], BGImageout, providerSRC=cx.providers.Esri.WorldImagery, zoomLevel=gen_background_zoom)

# # Example usage
# #3 - make the cut in the dir/HDR
# #4 - extract the data with CFGRIB

# #compilMNH2Json()
# #menorData() 
    
    







