# -*- coding: utf-8 -*-
"""
Created on Tue Oct  1 16:14:48 2024

@author: Lucas
"""

import pandas as pd
import networkx as nx
import matplotlib.pyplot as plt
import pygeohash as pgh
from geopy import distance
import overpass
import re
from sklearn.cluster import DBSCAN
import numpy as np

# bbox corse
lon_min = 8.48
lon_max = 9.62
lat_min = 41.33
lat_max = 43.03 

###########
# sources #
###########

api = overpass.API()
powerplants = api.get(f"way [power=plant]({lat_min},{lon_min},{lat_max},{lon_max});(._;>;)")

haute_tension = pd.read_csv('lignes-haute-tension-htb-aerien.csv', sep=";")
haute_tension_souterrain = pd.read_csv('lignes-haute-tension-htb-souterrain.csv', sep=";")

postes_sources = pd.read_csv('postes-sources.csv', sep=";")

#############
# centrales #
#############

def calculate_centroid_and_radius(points):
    if not points:
        return None
    x_coords, y_coords = zip(*points)  # Unzip the list of points
    centroid_x = sum(x_coords) / len(x_coords)
    centroid_y = sum(y_coords) / len(y_coords)
    radius = max(distance.distance((centroid_x, centroid_y), (lat, lon)).meters for lat, lon in points)
    return pd.Series([centroid_x, centroid_y, radius])

# extract all polygons from json
sources = pd.DataFrame({'geometry' : [i['geometry']['coordinates'][0] for i in powerplants['features']], 
                         'power' : [i['properties']['tags'].get('plant:output:electricity') for i in powerplants['features']]})
# generate centroid for each
sources[['lon', 'lat', 'radius']] = sources['geometry'].apply(calculate_centroid_and_radius)

# format power value
sources = sources.fillna("0")
sources['power'] = sources['power'].apply(lambda x : re.search(r'[0-9]+\.?[0-9]*', x).group(0) if re.search(r'[0-9]+\.?[0-9]*', x) else "0").astype(float)

# merge + add up power for those that are close
coords = np.radians(sources[['lat', 'lon']].values)

kms_per_radian = 6371.0088  # Earth's radius in kilometers
epsilon = 50 / 1000 / kms_per_radian  # 100 meters in radians
db = DBSCAN(eps=epsilon, min_samples=1, metric='haversine').fit(coords)

sources['cluster'] = db.labels_

sources = sources.groupby('cluster').agg({'lon': 'mean', 'lat': 'mean', 'power': 'sum', 'radius': 'sum'}).reset_index(drop=True)

# filter out sources with low power
sources = sources[sources['power'] >= 10]

# geohash
sources["geohash"] = sources.apply(lambda x : pgh.encode(latitude=x["lat"], longitude=x["lon"]), axis=1)

##################
# postes sources #
##################

# takes coordinates of a point and a list of points
# merges given point to nearest point from list if under a certain distance
def find_nearest_substation(row, lat, lon, substations, max_distance):
    pylon_coords = (row[lat], row[lon])
    for _, substation in substations.iterrows():
        substation_coords = (substation['lat'], substation['lon'])
        if distance.distance(pylon_coords, substation_coords).meters <= max_distance:
            return pd.Series([substation['lat'], substation['lon']])  # Return the coordinates of the nearby substation
    return pd.Series([row[lat], row[lon]])  # Return original coordinates if no nearby substation found

postes = postes_sources["Geo Shape"].str.extract('([0-9]+.?[0-9]*, [0-9]+.?[0-9]*)')
postes["lon"] = postes[0].str.split(', ').str[0].str.strip().astype(float)
postes["lat"] = postes[0].str.split(', ').str[1].str.strip().astype(float)

#########################
# pylones haute tension #
#########################

haute_tension = pd.concat([haute_tension, haute_tension_souterrain])

nodes_ht = haute_tension["Geo Shape"].str.extract('([0-9]+.?[0-9]*, [0-9]+.?[0-9]*)')
nodes_ht = pd.concat([nodes_ht, haute_tension["Geo Shape"].str.findall('([0-9]+.?[0-9]*, [0-9]+.?[0-9]*)').apply(lambda x : x[-1])])
nodes_ht = nodes_ht.drop_duplicates().rename_axis("id").reset_index(drop=True)
nodes_ht["lon"] = nodes_ht[0].str.split(', ').str[0].str.strip().astype(float)
nodes_ht["lat"] = nodes_ht[0].str.split(', ').str[1].str.strip().astype(float)

# merge lines close to substation
nodes_ht[['lat', 'lon']] = nodes_ht.apply(find_nearest_substation, axis=1, lat='lat', lon='lon', substations=postes, max_distance=50)

nodes_ht = nodes_ht.drop_duplicates(subset=['lon', 'lat']).reset_index(drop=True)
nodes_ht["geohash"] = nodes_ht.apply(lambda x : pgh.encode(latitude=x["lat"], longitude=x["lon"]), axis=1)

edges_ht = haute_tension["Geo Shape"].str.findall('([0-9]+.?[0-9]*, [0-9]+.?[0-9]*)').to_frame()
edges_ht["from"] = edges_ht["Geo Shape"].apply(lambda x : x[0])
edges_ht["from_lon"] = edges_ht["from"].str.split(', ').str[0].str.strip().astype(float)
edges_ht["from_lat"] = edges_ht["from"].str.split(', ').str[1].str.strip().astype(float)
edges_ht[['from_lat', 'from_lon']] = edges_ht.apply(find_nearest_substation, axis=1, lat='from_lat', lon='from_lon', substations=postes, max_distance=50)
edges_ht["to"] = edges_ht["Geo Shape"].apply(lambda x : x[-1])
edges_ht["to_lon"] = edges_ht["to"].str.split(', ').str[0].str.strip().astype(float)
edges_ht["to_lat"] = edges_ht["to"].str.split(', ').str[1].str.strip().astype(float)
edges_ht[['to_lat', 'to_lon']] = edges_ht.apply(find_nearest_substation, axis=1, lat='to_lat', lon='to_lon', substations=postes, max_distance=50)

edges_ht = edges_ht.drop_duplicates(subset=['from_lon', 'from_lat', 'to_lon', 'to_lat']).reset_index(drop=True)

edges_ht["from_geohash"] = edges_ht.apply(lambda x : pgh.encode(latitude=x["from_lat"], longitude=x["from_lon"]), axis=1)
edges_ht["to_geohash"] = edges_ht.apply(lambda x : pgh.encode(latitude=x["to_lat"], longitude=x["to_lon"]), axis=1)

################################
# combine sources and nodes_ht #
################################

def find_close_points(row, pylones):
    max_distance = row['radius'] + 50
    point1 = (row['lat'], row['lon'])
    close_matches = []
    
    for _, row2 in pylones.iterrows():
        point2 = (row2['lat'], row2['lon'])
        dist = distance.distance(point1, point2).meters
        
        if dist <= max_distance:
            close_matches.append(row2['geohash'])
    
    return close_matches

# connect source nodes with all nearby nodes_ht nodes
sources['connections'] = sources.apply(find_close_points, axis=1, pylones=nodes_ht)
sources = sources[sources['connections'].apply(len) > 0]

edges_sources = sources.drop(columns=['lon', 'lat', 'power', 'radius']).explode('connections')
edges = pd.concat([edges_ht[['from_geohash', 'to_geohash']], edges_sources.rename(columns={'geohash':'from_geohash', 'connections':'to_geohash'})], ignore_index=True)
edges = edges[edges['from_geohash'] != edges['to_geohash']]

# merge nodes_ht and sources with column determining type
nodes_ht['type'] = 'pylone'
sources['type'] = 'source'
nodes = pd.concat([nodes_ht.drop(columns=[0, 'lon', 'lat']), sources.drop(columns=['lon', 'lat', 'power', 'connections', 'radius'])], ignore_index=True)

########
# save #
########

nodes.to_json('nodes.json', orient='split', index=False)
edges.to_json('edges.json', orient='split', index=False)

##########
# réseau #
##########

graph = nx.from_pandas_edgelist(edges, 'from_geohash', 'to_geohash')

components = list(nx.connected_components(graph))

for index, row in nodes.iterrows():
    lat, lon = pgh.decode(row['geohash'])
    graph.nodes[row['geohash']]['pos'] = (lon, lat)
    graph.nodes[row['geohash']]['type'] = row['type']

########
# show #
########

pos = nx.get_node_attributes(graph, 'pos')

node_sizes = []
node_colors = []
for node in graph.nodes:
    if graph.nodes[node]['type'] == 'source':
        node_sizes.append(50)  # Larger size for sources
        node_colors.append('orange')  # Yellow color for sources
    else:
        node_sizes.append(10)  # Default size for other types
        node_colors.append('blue')  # Default color for other types

plt.figure(figsize=(10, 20))
#nx.draw(graph, pos=pos, node_size=node_sizes, node_color=node_colors)
nx.draw_networkx_edges(graph, pos=pos)
nx.draw_networkx_nodes(graph, pos=pos, node_size=node_sizes, node_color=node_colors)
plt.axis('off')
plt.show()

for idx, component in enumerate(components):
    plt.figure(figsize=(10, 20))
    
    nx.draw_networkx_edges(graph, pos=pos, alpha=0.5, edge_color='lightgray')

    subgraph = graph.subgraph(component)
    
    sub_node_sizes = []
    sub_node_colors = []

    for node in subgraph.nodes:
        if subgraph.nodes[node]['type'] == 'source':
            sub_node_sizes.append(50)
            sub_node_colors.append('orange')
        else:
            sub_node_sizes.append(10)
            sub_node_colors.append('blue')
    
    nx.draw_networkx_nodes(subgraph, pos=pos, node_size=sub_node_sizes, node_color=sub_node_colors)
    plt.axis('off')
    plt.show()
