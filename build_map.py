import os
import json
import time
import numpy as np
import pandas as pd
import geopandas as gpd
from shapely.strtree import STRtree
from scipy.interpolate import RegularGridInterpolator

GRID_ROWS = 400
GRID_COLS = 800

DATA_DIR = "earth_map_data"
ETOPO_FILE_PATH = os.path.join(DATA_DIR, "etopo180.csv")
CLIMATE_JSON_PATH = os.path.join(DATA_DIR, "climate_data.json")

LOCAL_FILES = {
    "countries": "ne_10m_admin_0_countries.geojson",
    "provinces": "ne_10m_admin_1_states_provinces.geojson",
    "rivers": "ne_10m_rivers_lake_centerlines.geojson",
    "lakes": "ne_10m_lakes.geojson",
    "marine": "ne_10m_geography_marine_polys.geojson",
    "regions": "ne_10m_geography_regions_polys.geojson",
    "places": "ne_10m_populated_places.geojson"
}

def load_local_gis_datasets():
    if not os.path.exists(DATA_DIR):
        raise FileNotFoundError(f"'{DATA_DIR}' 폴더가 존재하지 않습니다.")

    datasets = {}
    print("-> 로컬 GIS 데이터셋 로딩 중...")
    for key, filename in LOCAL_FILES.items():
        file_path = os.path.join(DATA_DIR, filename)
        if os.path.exists(file_path):
            print(f"    로드 완료: {filename}")
            datasets[key] = gpd.read_file(file_path).to_crs(epsg=4326)
        else:
            print(f"    [경고] 파일을 찾을 수 없습니다: {file_path}")
            datasets[key] = None
    return datasets

def load_climate_json(file_path=CLIMATE_JSON_PATH):
    """실제 기후 데이터 JSON 파일을 불러옵니다."""
    if os.path.exists(file_path):
        with open(file_path, "r", encoding="utf-8") as f:
            print(f"-> 성공: {file_path} 기후 데이터 파일을 불러왔습니다.")
            return json.load(f)
    print(f"[경고] '{file_path}' 파일을 찾을 수 없습니다. 수식 기반 모델로 대체됩니다.")
    return {}

def fetch_actual_etopo_elevation(target_pts):
    if not os.path.exists(ETOPO_FILE_PATH):
        print(f"[경고] '{ETOPO_FILE_PATH}' 파일이 없습니다. 고도를 0으로 초기화합니다.")
        return np.zeros(len(target_pts), dtype=int)

    print("-> 실측 ETOPO CSV 파싱 및 고도 보간 중...")
    df_raw = pd.read_csv(ETOPO_FILE_PATH, skiprows=[1])
    df_raw.columns = [c.strip().lower() for c in df_raw.columns]
    
    lat_col = next(c for c in df_raw.columns if 'lat' in c)
    lon_col = next(c for c in df_raw.columns if 'lon' in c)
    alt_col = next(c for c in df_raw.columns if 'alt' in c or 'topo' in c or 'elev' in c)

    pivot_dem = df_raw.pivot(index=lat_col, columns=lon_col, values=alt_col)
    pivot_dem = pivot_dem.sort_index(ascending=True)
    pivot_dem = pivot_dem.reindex(sorted(pivot_dem.columns), axis=1)

    interp_func = RegularGridInterpolator(
        (pivot_dem.index.values, pivot_dem.columns.values), 
        pivot_dem.values, 
        bounds_error=False, 
        fill_value=0
    )

    real_elevations = interp_func(target_pts)
    return np.round(real_elevations).astype(int)

def generate_climate_data_vectorized(target_pts, elevations, country_code_arr, province_code_arr, climate_json, target_month="1995-07"):
    """
    인위적인 사막 생성 노이즈 코드를 제거하고, 실제 기온 및 지리적 데이터 기반으로 기후대를 연산합니다.
    """
    print(f"-> 벡터화 기후 데이터 및 모델 연산 중 (조회 월: {target_month})...")
    lats = target_pts[:, 0]
    lons = target_pts[:, 1]
    
    # 1. JSON 데이터에서 해당 월의 기온 맵 구성
    temp_map = {}
    for region_key, months in climate_json.items():
        if target_month in months:
            temp_map[region_key] = months[target_month]

    prov_series = pd.Series(province_code_arr)
    country_series = pd.Series(country_code_arr)
    
    mapped_temps = prov_series.map(temp_map).values
    country_mapped = country_series.map(temp_map).values
    mapped_temps = np.where(pd.isna(mapped_temps), country_mapped, mapped_temps)

    # 2. 백업 수식 기온 계산 (벡터 연산)
    base_temps = 28.0 * np.cos(np.radians(lats)) - 45.0 * (np.abs(lats) / 90.0) ** 2
    current_effect = 3.0 * np.sin(np.radians(lons * 1.5))
    continental_offset = 5.0 * np.cos(np.radians(lats)) * np.sin(np.radians(lons))
    adjusted_base_temps = base_temps + current_effect + continental_offset
    lapse_rate = 0.65 / 100.0
    fallback_temps = adjusted_base_temps - (elevations * lapse_rate)

    final_temperatures = np.where(pd.isna(mapped_temps), fallback_temps, mapped_temps)
    final_temperatures = np.where(elevations <= 0, 0.0, final_temperatures)

    is_ocean = elevations <= 0
    
    # 3. 기후대 문자열 배열 생성 (온도 임계값 기준 분류)
    climates = np.empty(len(target_pts), dtype=object)
    climates[is_ocean] = "바다"
    
    mask_polar = (~is_ocean) & (final_temperatures < -15)
    mask_subarctic = (~is_ocean) & (final_temperatures >= -15) & (final_temperatures < 0)
    mask_temperate = (~is_ocean) & (final_temperatures >= 0) & (final_temperatures < 15)
    mask_subtropical_zone = (~is_ocean) & (final_temperatures >= 15) & (final_temperatures < 22)
    mask_tropical = (~is_ocean) & (final_temperatures >= 22)

    t_str = np.vectorize(lambda t: f"{t:+.1f}°C")
    
    climates[mask_polar] = "툰트라/극지방(" + t_str(final_temperatures[mask_polar]) + ")"
    climates[mask_subarctic] = "냉대/북해(" + t_str(final_temperatures[mask_subarctic]) + ")"
    climates[mask_temperate] = "온대(" + t_str(final_temperatures[mask_temperate]) + ")"
    climates[mask_subtropical_zone] = "아열대(" + t_str(final_temperatures[mask_subtropical_zone]) + ")"
    climates[mask_tropical] = "열대(" + t_str(final_temperatures[mask_tropical]) + ")"

    return final_temperatures, climates

def build_fast_earth_json(output_path="./map/earth_grid_400x800.json", target_month="1995-07"):
    start_time = time.time()
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    
    datasets = load_local_gis_datasets()
    climate_json = load_climate_json(CLIMATE_JSON_PATH)

    print("\n1. 좌표 매트릭스 고속 생성 중...")
    lat_step = 180.0 / GRID_ROWS
    lon_step = 360.0 / GRID_COLS
    
    lats = np.linspace(90.0 - (lat_step / 2), -90.0 + (lat_step / 2), GRID_ROWS)
    lons = np.linspace(-180.0 + (lon_step / 2), 180.0 - (lon_step / 2), GRID_COLS)

    lon_grid, lat_grid = np.meshgrid(lons, lats)
    flat_lons = np.round(lon_grid.flatten(), 4)
    flat_lats = np.round(lat_grid.flatten(), 4)
    total_cells = GRID_ROWS * GRID_COLS
    target_pts = np.column_stack([flat_lats, flat_lons])
    
    points = gpd.points_from_xy(flat_lons, flat_lats)

    print("2. STRtree 고속 공간 인덱싱(Vectorized) 기반 레이어 매핑 중...")
    
    country_arr = np.full(total_cells, "", dtype=object)
    country_code_arr = np.full(total_cells, "", dtype=object)
    province_arr = np.full(total_cells, "", dtype=object)
    province_code_arr = np.full(total_cells, "", dtype=object)
    region_arr = np.full(total_cells, "", dtype=object)
    marine_arr = np.full(total_cells, "", dtype=object)
    place_arr = np.full(total_cells, "", dtype=object)

    def map_polygons(dataset_key, name_cols, out_array):
        if datasets.get(dataset_key) is not None:
            gdf = datasets[dataset_key]
            c_col = next((c for c in name_cols if c in gdf.columns), None)
            if c_col:
                geoms = gdf.geometry.values
                names = gdf[c_col].fillna('').values
                tree = STRtree(geoms)
                pts_idx, geom_idx = tree.query(points, predicate='intersects')
                if len(pts_idx) > 0:
                    unique_pts, first_indices = np.unique(pts_idx, return_index=True)
                    out_array[unique_pts] = names[geom_idx[first_indices]]

    map_polygons("countries", ['NAME_LONG', 'ADMIN', 'NAME', 'SOVEREIGNT'], country_arr)
    map_polygons("provinces", ['NAME', 'name', 'name_en'], province_arr)
    
    if datasets.get("countries") is not None:
        gdf_c = datasets["countries"]
        iso_col = next((c for c in ['ISO_A3', 'ADM0_A3', 'su_a3'] if c in gdf_c.columns), None)
        if iso_col:
            geoms = gdf_c.geometry.values
            codes = gdf_c[iso_col].fillna('').values
            tree = STRtree(geoms)
            pts_idx, geom_idx = tree.query(points, predicate='intersects')
            if len(pts_idx) > 0:
                unique_pts, first_indices = np.unique(pts_idx, return_index=True)
                country_code_arr[unique_pts] = codes[geom_idx[first_indices]]

    if datasets.get("provinces") is not None:
        gdf_p = datasets["provinces"]
        prov_id_col = next((c for c in ['code_hasc', 'adm1_code', 'woe_id'] if c in gdf_p.columns), None)
        if prov_id_col:
            geoms = gdf_p.geometry.values
            p_codes = gdf_p[prov_id_col].fillna('').values
            tree = STRtree(geoms)
            pts_idx, geom_idx = tree.query(points, predicate='intersects')
            if len(pts_idx) > 0:
                unique_pts, first_indices = np.unique(pts_idx, return_index=True)
                province_code_arr[unique_pts] = p_codes[geom_idx[first_indices]]

    map_polygons("regions", ['NAME', 'name', 'name_en'], region_arr)
    map_polygons("marine", ['NAME', 'name', 'NAME_LONG'], marine_arr)
    
    if datasets["places"] is not None:
        gdf = datasets["places"]
        pl_col = next((c for c in ['NAME', 'name', 'NAMEASCII'] if c in gdf.columns), None)
        if pl_col:
            tree = STRtree(gdf.geometry.values)
            pts_idx, geom_idx = tree.query(points, predicate='dwithin', distance=0.3)
            if len(pts_idx) > 0:
                unique_pts, first_indices = np.unique(pts_idx, return_index=True)
                names = gdf[pl_col].fillna('').values
                place_arr[unique_pts] = names[geom_idx[first_indices]]

    river_arr = np.zeros(total_cells, dtype=bool)
    print("-> 강 및 호수 데이터 (RIVER) 연산 중...")
    water_geoms = []
    if datasets["rivers"] is not None: water_geoms.extend(datasets["rivers"].geometry.values)
    if datasets["lakes"] is not None: water_geoms.extend(datasets["lakes"].geometry.values)
        
    if water_geoms:
        water_tree = STRtree(water_geoms)
        pts_idx, _ = water_tree.query(points, predicate='dwithin', distance=max(lat_step, lon_step)/2)
        if len(pts_idx) > 0:
            river_arr[np.unique(pts_idx)] = True

    print("3. 실측 고도, 실제 기후 데이터(JSON) 및 고도 레벨 일괄 연산 중...")
    elevations = fetch_actual_etopo_elevation(target_pts)
    
    temperatures, climates = generate_climate_data_vectorized(
        target_pts, elevations, country_code_arr, province_code_arr, climate_json, target_month
    )

    # 고도(LEVEL) 기준 적용 (벡터화)
    level_arr = np.zeros(total_cells, dtype=int)
    level_arr[elevations <= -1250] = 0
    level_arr[(elevations > -1250) & (elevations <= 0)] = 1
    level_arr[(elevations > 0) & (elevations <= 150)] = 2
    level_arr[(elevations > 150) & (elevations <= 800)] = 3
    level_arr[(elevations > 800) & (elevations <= 1600)] = 4
    level_arr[elevations > 1600] = 5

    print("4. 명세서에 맞춘 JSON 구조체 생성 중 (병목 제거)...")
    
    map_x = np.arange(total_cells) % GRID_COLS
    map_y = np.arange(total_cells) // GRID_COLS
    
    final_names = np.full(total_cells, "Unknown", dtype=object)
    for arr in (marine_arr, region_arr, country_arr, province_arr, place_arr):
        mask = arr != ""
        final_names[mask] = arr[mask]

    result_json = {
        int(i + 1): {
            "NAME": str(name),
            "POSITION": [float(lat), float(lon)],
            "MAP_POSITION": [int(x), int(y)],
            "ELEVATION": int(elev),
            "LEVEL": int(lvl),
            "CLIMATE": str(clim),
            "RIVER": bool(riv)
        }
        for i, (name, lat, lon, x, y, elev, lvl, clim, riv) in enumerate(zip(
            final_names, flat_lats, flat_lons, map_x, map_y, 
            elevations, level_arr, climates, river_arr
        ))
    }

    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(result_json, f, ensure_ascii=False, indent=4)

    print(f"완료! 소요 시간: {time.time() - start_time:.2f}초, 파일 저장 경로: {output_path}")

if __name__ == "__main__":
    build_fast_earth_json()