import geopandas as gpd
import pandas as pd
import json
import os

def generate_province_specifications():
    # 1. 파일 경로 설정 (경로 확인)
    provinces_path = "earth_map_data/ne_10m_admin_1_states_provinces.geojson"
    countries_path = "earth_map_data/ne_10m_admin_0_countries.geojson"
    regions_path = "earth_map_data/ne_10m_geography_regions_polys.geojson"
    places_path = "earth_map_data/ne_10m_populated_places.geojson"
    grid_path = "map/earth_grid_400x800.json"
    
    print("🌍 지리 및 행정 데이터 로딩 중...")
    
    try:
        gdf_provinces = gpd.read_file(provinces_path)
        gdf_countries = gpd.read_file(countries_path)
        gdf_regions = gpd.read_file(regions_path)
        gdf_places = gpd.read_file(places_path)
        
        with open(grid_path, "r", encoding="utf-8") as f:
            grid_data = json.load(f)
    except Exception as e:
        print(f"❌ 데이터를 불러오는 데 실패했습니다: {e}")
        return

    # 맵 그리드 룩업 테이블 생성 (MAP_POSITION 기준 빠른 검색용)
    grid_lookup = {}
    for k, cell in grid_data.items():
        if "MAP_POSITION" in cell:
            pos_key = tuple(cell["MAP_POSITION"])
            grid_lookup[pos_key] = cell

    # 좌표계(CRS) 일치화
    if gdf_countries.crs != gdf_provinces.crs:
        gdf_countries = gdf_countries.to_crs(gdf_provinces.crs)
    if gdf_regions.crs != gdf_provinces.crs:
        gdf_regions = gdf_regions.to_crs(gdf_provinces.crs)
    if gdf_places.crs != gdf_provinces.crs:
        gdf_places = gdf_places.to_crs(gdf_provinces.crs)

    # 2. 국가 데이터(admin_0_countries) 공간 조인
    try:
        print("🔗 국가 데이터(Countries) 공간 조인 중...")
        provinces_with_country = gpd.sjoin(gdf_provinces, gdf_countries, how="left", predicate="intersects")
        provinces_with_country = provinces_with_country[~provinces_with_country.index.duplicated(keep='first')]
        country_col = 'ADMIN' if 'ADMIN' in provinces_with_country.columns else ('NAME' if 'NAME' in provinces_with_country.columns else 'admin')
    except Exception as e:
        print(f"⚠️ 국가 데이터 처리 중 오류 발생: {e}")
        provinces_with_country = gdf_provinces
        country_col = None

    # 3. 지방/지역 데이터(geography_regions_polys) 공간 조인
    try:
        print("🔗 지방/지역 데이터(Regions) 공간 조인 중...")
        provinces_with_all = gpd.sjoin(provinces_with_country, gdf_regions, how="left", predicate="intersects", rsuffix="_region")
        provinces_with_all = provinces_with_all[~provinces_with_all.index.duplicated(keep='first')]
        region_col = 'name' if 'name' in provinces_with_all.columns else ('NAME' if 'NAME' in provinces_with_all.columns else 'type_en')
    except Exception as e:
        print(f"⚠️ 지역 데이터 처리 중 오류 발생: {e}")
        provinces_with_all = provinces_with_country
        region_col = None

    # 4. 인구 데이터(populated_places) 전처리 및 30만 초과 도시 필터링
    pop_col = None
    for col in gdf_places.columns:
        if col.upper() in ['POP_MAX', 'POP_EST', 'POPULATION', 'POP_MIN']:
            pop_col = col
            break
            
    if pop_col:
        gdf_places[pop_col] = pd.to_numeric(gdf_places[pop_col], errors='coerce').fillna(0)
        gdf_places = gdf_places[gdf_places[pop_col] > 300000]

    city_name_col = 'NAME' if 'NAME' in gdf_places.columns else ('name' if 'name' in gdf_places.columns else 'NAMEASCII')

    # 5. 프로빈스별 대표 도시 및 인구 매핑 (안정적인 하이브리드 방식)
    print("🔗 프로빈스와 도시 데이터 매칭 및 인구 집계 중 (30만 초과 도시 기준)...")
    province_city_mapping = {}

    # 1차: 행정구역 이름 기반 매칭 (빈 파일 생성 방지)
    if 'ADM1NAME' in gdf_places.columns:
        for idx, row in provinces_with_all.iterrows():
            p_name = str(row.get('name', row.get('NAME', ''))).strip().lower()
            if not p_name:
                continue
            matched_cities = gdf_places[gdf_places['ADM1NAME'].astype(str).str.strip().str.lower() == p_name]
            if not matched_cities.empty:
                max_city_row = matched_cities.loc[matched_cities[pop_col].idxmax()]
                city_name = str(max_city_row.get(city_name_col, 'Unknown')).strip()
                total_pop = int(matched_cities[pop_col].sum())
                
                city_geom = max_city_row.geometry
                if city_geom is not None:
                    lat = float(city_geom.y)
                    lon = float(city_geom.x)
                else:
                    centroid = row.geometry.centroid
                    lat = float(centroid.y)
                    lon = float(centroid.x)

                province_city_mapping[idx] = {
                    'city_name': city_name,
                    'population': total_pop,
                    'lat': lat,
                    'lon': lon
                }

    # 2차: 이름 매칭으로 잡히지 않은 항목들은 공간 조인(intersects)으로 보완
    if len(province_city_mapping) == 0:
        print("🔄 이름 매칭 결과가 없어 공간 조인(Spatial Join)으로 보완 집계 시도 중...")
        try:
            joined_places = gpd.sjoin(provinces_with_all, gdf_places, how="inner", predicate="intersects")
            for p_idx, group in joined_places.groupby(joined_places.index):
                if group.empty:
                    continue
                max_city_row = group.loc[group[pop_col].idxmax()]
                city_name = str(max_city_row.get(city_name_col, 'Unknown')).strip()
                total_pop = int(group[pop_col].sum())
                
                city_geom = max_city_row.geometry
                if city_geom is not None:
                    lat = float(city_geom.y)
                    lon = float(city_geom.x)
                else:
                    centroid = provinces_with_all.loc[p_idx].geometry.centroid
                    lat = float(centroid.y)
                    lon = float(centroid.x)

                province_city_mapping[p_idx] = {
                    'city_name': city_name,
                    'population': total_pop,
                    'lat': lat,
                    'lon': lon
                }
        except Exception as e:
            print(f"⚠️ 공간 조인 보완 중 오류 발생: {e}")

    province_specs = {}
    valid_id_counter = 1

    print("📦 바다 영역 및 조건 필터링 후 명세 생성 중...")
    
    GRID_COLS = 800
    GRID_ROWS = 400

    for idx, row in provinces_with_all.iterrows():
        if idx not in province_city_mapping:
            continue
            
        city_info = province_city_mapping[idx]
        province_name = city_info['city_name']
        
        county_name = str(row.get(region_col, 'General'))
        if not county_name or county_name == 'nan':
            county_name = 'General'
            
        country_name = str(row.get(country_col, 'Unknown'))
        if not country_name or country_name == 'nan':
            country_name = 'Unknown'

        # 바다 및 해양 영역 필터링
        combined_text = (province_name + " " + county_name + " " + country_name).lower()
        if any(keyword in combined_text for keyword in ['ocean', 'sea', 'water', '바다', '해양']):
            continue
            
        pop_val = city_info['population']
        if pop_val == 0:
            continue
            
        lat = city_info['lat']
        lon = city_info['lon']

        # 그리드 좌표 연산
        gx = int(((lon + 180) % 360) / 360 * GRID_COLS)
        gy = int((90 - lat) / 180 * GRID_ROWS)
        gx = max(0, min(GRID_COLS - 1, gx))
        gy = max(0, min(GRID_ROWS - 1, gy))

        # earth_grid_400x800.json의 MAP_POSITION 참조 반영
        grid_cell = grid_lookup.get((gx, gy))
        map_position = grid_cell["MAP_POSITION"] if grid_cell else [gx, gy]

        # 6. 최종 구조 명세서 구성 (POSITION 바로 뒤에 MAP_POSITION 배치)
        province_specs[valid_id_counter] = {
            "PROVINCE_NAME": province_name,
            "COUNTY_NAME": county_name,
            "COUNTRY_NAME": country_name,
            "POSITION": [lat, lon],
            "MAP_POSITION": map_position,  # earth_grid 연동 값 삽입
            "RESOURCE": {
                "RESOURCE_NAME": "",
                "RESOURCE_LEVEL": 0
            },
            "POPULATION": pop_val,
            "DEVELOPMENT_LEVEL": None,
            "BUILDING_LIST": []
        }
        valid_id_counter += 1

    # 7. JSON 파일로 내보내기
    output_filename = "./map/province_specifications.json"
    os.makedirs(os.path.dirname(output_filename), exist_ok=True)
    with open(output_filename, "w", encoding="utf-8") as f:
        json.dump(province_specs, f, ensure_ascii=False, indent=4)
        
    print(f"✨ 생성 완료! 총 {len(province_specs)}개의 프로빈스 명세서가 '{output_filename}' 파일로 저장되었습니다.")

if __name__ == "__main__":
    generate_province_specifications()