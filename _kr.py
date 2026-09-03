import json,urllib.request,re,os
exec(open('_nscnt.py').read().split('stu=gj')[0])
le=gj(BADB.format("LogicEffect_PC"))
le=le.get("DataList") if isinstance(le,dict) else le
for r in le:
    g=str(r.get("GroupId") or "")
    if "FormConversionEffectDAO" in str(r.get("$type") or "") and g.startswith("CH0173"):
        print(g,"Level",r.get("Level"),"FCEnd",r.get("FormConversionEndCondition"),"Arg",r.get("EndConditionArgument"))
