import json

# 파일 경로 설정
input_filename = "./map/earth_grid_400x800.json"
output_filename = "./map/earth_grid_400x800_indented.json"

# 1. 한 줄로 된 JSON 파일 읽기
with open(input_filename, "r", encoding="utf-8") as f:
    data = json.load(f)

# 2. 들여쓰기(indent=4)를 적용하여 새로운 파일로 저장
# ensure_ascii=False를 설정해야 한글이 깨지지 않고 정상적으로 출력됩니다.
with open(output_filename, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=4)

print(f"성공적으로 정렬되었습니다: {output_filename}")