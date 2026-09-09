import json
import os
import geopandas as gpd
import pandas as pd


def generate_province_data():
    provinces_path = "earth_map_data/ne_10m_admin_1_states_provinces.geojson"
    places_path = "earth_map_data/ne_10m_populated_places.geojson"

    print("🌍 프로빈스 및 도시 데이터 로딩 중...")
    try:
        gdf_provinces = gpd.read_file(provinces_path)
        gdf_places = gpd.read_file(places_path)
    except Exception as e:
        print(f"❌ 데이터를 불러오는 데 실패했습니다: {e}")
        return

    # 좌표계(CRS) 통일 및 지오메트리 보정
    base_crs = (
        gdf_provinces.crs if gdf_provinces.crs is not None else "EPSG:4326"
    )
    if gdf_provinces.crs is None:
        gdf_provinces.set_crs(base_crs, inplace=True)
    if gdf_places.crs is None:
        gdf_places.set_crs(base_crs, inplace=True)
    elif gdf_places.crs != base_crs:
        gdf_places.to_crs(base_crs, inplace=True)

    gdf_provinces["geometry"] = gdf_provinces["geometry"].buffer(0)

    # 인구 데이터 컬럼 전처리
    pop_col = next(
        (
            c
            for c in gdf_places.columns
            if c.upper() in ["POP_MAX", "POP_EST", "POPULATION", "POP_MIN"]
        ),
        "POP_MAX",
    )
    if pop_col in gdf_places.columns:
        gdf_places[pop_col] = pd.to_numeric(
            gdf_places[pop_col], errors="coerce"
        ).fillna(100000)
    else:
        gdf_places[pop_col] = 100000

    city_name_col = (
        "NAME"
        if "NAME" in gdf_places.columns
        else ("name" if "name" in gdf_places.columns else "NAMEASCII")
    )
    country_col = "admin" if "admin" in gdf_provinces.columns else "ADMIN"

    print("🔗 공간 조인 및 대표 도시 매칭 중...")

    # 1. 공간 조인 (Provinces <-> Places)
    joined_places = gpd.sjoin(
        gdf_provinces, gdf_places, how="inner", predicate="intersects"
    )

    province_city_mapping = {}
    matched_indices = set()

    if not joined_places.empty:
        max_pop_idx = joined_places.groupby(joined_places.index)[
            pop_col
        ].idxmax()
        matched_cities = joined_places.loc[max_pop_idx]

        for idx, row in matched_cities.iterrows():
            province_city_mapping[idx] = {
                "city_name": str(row.get(city_name_col, "Unknown")).strip(),
                "population": int(row.get(pop_col, 100000)),
            }
            matched_indices.add(idx)

    # 2. 미매칭 프로빈스 고속 nearest 조인 (투영 좌표계로 변환하여 연산)
    unmatched_mask = ~gdf_provinces.index.isin(matched_indices)
    if unmatched_mask.any():
        unmatched_proj = gdf_provinces[unmatched_mask].to_crs("EPSG:3857")
        places_proj = gdf_places.to_crs("EPSG:3857")

        unmatched_centroids = unmatched_proj.copy()
        unmatched_centroids["geometry"] = unmatched_proj.geometry.centroid

        nearest_cities = gpd.sjoin_nearest(
            unmatched_centroids, places_proj, how="left"
        )
        nearest_cities = nearest_cities[
            ~nearest_cities.index.duplicated(keep="first")
        ]

        for idx, row in nearest_cities.iterrows():
            province_city_mapping[idx] = {
                "city_name": str(row.get(city_name_col, "Capital")).strip(),
                "population": int(row.get(pop_col, 100000)),
            }

    # 3. JSON 명세 변환 (GeoJSON 원본 지명 추출)
    province_specs = {}
    valid_id_counter = 1

    print("📦 JSON 명세 변환 중...")
    for idx, row in gdf_provinces.iterrows():
        if idx not in province_city_mapping:
            continue

        # 번역 필드(name_ko)를 거치지 않고 GeoJSON 원본 속성(name 또는 NAME) 그대로 참조
        raw_province_name = (
            row.get("name")
            or row.get("NAME")
            or row.get("name_en")
            or row.get("NAME_EN")
            or "Unknown"
        )
        province_name = str(raw_province_name).strip()
        if province_name in ["nan", "None", ""]:
            province_name = "Unknown"

        city_info = province_city_mapping[idx]
        capital_city = city_info["city_name"]
        country_name = str(row.get(country_col, "Unknown"))

        # 바다 및 해양 영역 필터링
        combined_text = (
            f"{province_name} {capital_city} {country_name}".lower()
        )
        if any(
            k in combined_text for k in ["ocean", "sea", "water", "바다", "해양"]
        ):
            continue

        capital_city_id = 1000 + valid_id_counter

        province_specs[valid_id_counter] = {
            "REGION_NAME": province_name,
            "COUNTRY_ID": 0,
            "CAPITAL_CITY_ID": capital_city_id,
            "REGION_POPULATION": city_info["population"],
            "DOMINION_DEGREE": 100,
            "DEVELOPMENT_LEVEL": 0,
            "RESOURCES": {},
            "REGIONAL_BUILDINGS": {},
        }
        valid_id_counter += 1

    # 저장
    output_dir = "./map"
    os.makedirs(output_dir, exist_ok=True)
    province_output_path = os.path.join(output_dir, "province.json")

    with open(province_output_path, "w", encoding="utf-8") as f:
        json.dump(province_specs, f, ensure_ascii=False, indent=4)

    print(
        f"✨ 생성 완료! '{province_output_path}' (총 {len(province_specs)}개)"
    )


if __name__ == "__main__":
    generate_province_data()