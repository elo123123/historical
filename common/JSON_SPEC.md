#JSON_SPEC

BUILDING
|"ROAD" : 
|[
| {
|  PRICE : (생산에 들어가는 CASH, INTEGER TYPE),
|  P_TIME : (생산시간 턴 수, INTEGER TYPE),
|  FIT_PLACE : (건설이 가능한 자원, STRING TYPE),
|  REQ_RES : [ (필요한 자원 이름(모두 1이 필요), STRING ARRAY TYPE) ],
|  MAINTENANCE : (건물 유지에 필요한 CASH, INTEGER TYPE),
|  BUILD_EFF : [ (건물 효과들(effect.json의 효과를 참조), STRING ARRAY TYPE) ]
| }
|]

EFFECT


RESOURCES
|'RESOURCES':{
| RES_NAME : STRING TYPE
| LEVEL : (1~5 사이의 값, INTEGER TYPE)
|}
