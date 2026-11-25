# ツールが読むデータの形の変化

新しいものが上。`scripts/schema-guard.py` が書く。**変化を見たら、その表を読む builder と画面を確かめる。**

## 2026-11-25

- **DB/EventContentSeasonExcelTable**
  - 値が増えた `.DataList[].EventContentReleaseType`: PermanentMiniGame
  - 値が増えた `.DataList[].OpenConditionContent`: None
- **DB/EventContentTreasureExcelTable**
  - 欄が増えた `.DataList[].IsCertainOpen`（bool）
  - 値が増えた `.DataList[].UsePrefabName`: UIEventTreasureShop_865
- **DB/EventContentTreasureRoundExcelTable**
  - 欄が増えた `.DataList[].CertainOpenChargeCount`（int）
  - 欄が増えた `.DataList[].CertainOpenGoodsId`（int）
- **DB/GoodsExcelTable**
  - 値が消えた `.DataList[].ConsumeGachaTicketType[]`: PackageThreeStar_R97_Explosion, PackageThreeStar_R97_Mystic, PackageThreeStar_R97_Pierce, PackageThreeStar_R97_Sonic
- **DB/ShopRefreshExcelTable**
  - 欄が増えた `.DataList[].DiscountRatio`（int）

## 2026-11-16（ba-data 10/21 版 → 11/11 版。見張りを入れた日に、10/28・11/11 の 2 回分をまとめて比べた）

- **DB/EliminateRaidStageExcelTable**
  - 欄が増えた `.DataList[].ExtraRoomLifeTime`（int）
- **DB/EventContentSeasonExcelTable**
  - 値が増えた `.DataList[].EventContentType`: MiniGameTank
  - 値が増えた `.DataList[].OpenConditionContent`: MiniGameTank
- **DB/GoodsExcelTable**
  - 値が増えた `.DataList[].ConsumeGachaTicketType[]`: PackageThreeStar_R97_Explosion, PackageThreeStar_R97_Mystic, PackageThreeStar_R97_Pierce, PackageThreeStar_R97_Sonic, PackageUnownedThreeStar
- **DB/GroundExcelTable**
  - 欄が増えた `.DataList[].StageTopography[]`（str）
  - 型が変わった `.DataList[].StageTopography`: str → list
- **DB/ItemExcelTable**
  - 値が増えた `.DataList[].GachaTicket`: PackageThreeStar_R97_Explosion, PackageThreeStar_R97_Mystic, PackageThreeStar_R97_Pierce, PackageThreeStar_R97_Sonic, PackageUnownedThreeStar
- **DB/RaidStageExcelTable**
  - 欄が増えた `.DataList[].ExtraRoomLifeTime`（int）
  - 値が増えた `.DataList[].RaidBossGroup`: EN0023
  - 値が増えた `.DataList[].RaidBossGroupType`: EN0023
- **DB/ShopExcelTable**
  - 値が増えた `.DataList[].CategoryType`: TacticalRelayBeta
- **DB/ShopInfoExcelTable**
  - 値が増えた `.DataList[].CategoryType`: TacticalRelayBeta
- **DB/ShopRecruitExcelTable**
  - 値が増えた `.DataList[].CategoryType`: UnownedTicketGacha
  - 値が増えた `.DataList[].DisplayTag`: Unowned
- **DB/SkillExcelTable**
  - 欄が増えた `.DataList[].SkillDamageTargetCount`（str）
  - 欄が増えた `.DataList[].SkillFilterActivate`（bool）
  - 欄が増えた `.DataList[].SkillKind`（str）
- **DB/WeekDungeonExcelTable**
  - 欄が増えた `.DataList[].EchelonRecommendPresetId`（int）
  - 欄が増えた `.DataList[].HideChaserPortraitSpawnTemplateId`（list）
  - 欄が増えた `.DataList[].HideChaserPortraitSpawnTemplateId[]`（str）
- **Excel/ConstCommonExcelTable**
  - 欄が増えた `.DataList[].GachaHistoryCount`（int）
  - 欄が増えた `.DataList[].GachaHistoryTimeToLiveInDays`（int）
  - 欄が増えた `.DataList[].ProductMonthlyExtensionLookbackDays`（int）

対応（2026-11-16）: StageTopography の配列化は build_tl を直し、悪夢急行（Indoor→Street）は総力戦ツールに trph を足した。
ExtraRoomLifeTime は総力戦のブザービート（ルームの時間切れ後に 10 分延長）で、1 戦の時間とスコアは変わらない。
TacticalRelayBeta は仮想適性試験 BETA のショップ、MiniGameTank は新しいミニゲーム、Unowned/PackageThreeStar は
未所持・属性確定のチケット募集で、どのツールの計算にも入らない。SkillExcelTable の 3 欄は TL（開発停止中）だけが読む。
