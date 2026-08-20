# Datenmodell

> **Automatisch erzeugt — nicht von Hand bearbeiten.**
> Quelle ist [`backend/prisma/schema.prisma`](../backend/prisma/schema.prisma).
> Neu erzeugen mit `npm run docs:datamodel` im Ordner `backend`.

Das Schema umfasst **37 Modelle**.

## Überblick

| Modell | Tabelle | Felder |
|--------|---------|--------|
| [Aenderung](#aenderung) | `aenderungen` | 11 |
| [Club](#club) | `clubs` | 9 |
| [DaySlot](#dayslot) | `day_slots` | 9 |
| [Field](#field) | `fields` | 8 |
| [FoodCategory](#foodcategory) | `food_categories` | 7 |
| [FoodDonation](#fooddonation) | `food_donations` | 12 |
| [FoodDonationSlot](#fooddonationslot) | `food_donation_slots` | 14 |
| [FoodItem](#fooditem) | `food_items` | 9 |
| [GlobalDayTemplate](#globaldaytemplate) | `global_day_templates` | 6 |
| [Group](#group) | `groups` | 8 |
| [KnockoutBracket](#knockoutbracket) | `knockout_brackets` | 9 |
| [Match](#match) | `matches` | 29 |
| [MaterialItem](#materialitem) | `material_items` | 8 |
| [PasswordResetToken](#passwordresettoken) | `password_reset_tokens` | 7 |
| [PushSubscription](#pushsubscription) | `push_subscriptions` | 8 |
| [Shift](#shift) | `shifts` | 15 |
| [ShoppingCatalogItem](#shoppingcatalogitem) | `shopping_catalog_items` | 9 |
| [ShoppingListItem](#shoppinglistitem) | `shopping_list_items` | 9 |
| [StandingsEntry](#standingsentry) | `standings_entries` | 13 |
| [Team](#team) | `teams` | 16 |
| [TemplateWorkArea](#templateworkarea) | `template_work_areas` | 8 |
| [TimeSlot](#timeslot) | `time_slots` | 11 |
| [Tournament](#tournament) | `tournaments` | 40 |
| [TournamentClub](#tournamentclub) | `tournament_clubs` | 5 |
| [TournamentDay](#tournamentday) | `tournament_days` | 10 |
| [TournamentDayWorkArea](#tournamentdayworkarea) | `tournament_day_work_areas` | 9 |
| [TournamentMembership](#tournamentmembership) | `tournament_memberships` | 6 |
| [TournamentWorkArea](#tournamentworkarea) | `tournament_work_areas` | 15 |
| [User](#user) | `users` | 30 |
| [UserChild](#userchild) | `volunteer_children` | 5 |
| [UserNotification](#usernotification) | `user_notifications` | 9 |
| [UserRole](#userrole) | `user_roles` | 4 |
| [VolunteerShift](#volunteershift) | `volunteer_shifts` | 17 |
| [WebAuthnCredential](#webauthncredential) | `webauthn_credentials` | 11 |
| [WorkArea](#workarea) | `arbeitsbereiche` | 13 |
| [WorkAreaCategory](#workareacategory) | `work_area_categories` | 7 |
| [YearGroup](#yeargroup) | `year_groups` | 15 |

---

## Aenderung

Wer hat wann was am Dienstplan geaendert. Mehrere Organisatoren planen inzwischen gleichzeitig und ueberschreiben sich dabei gelegentlich gegenseitig, ohne dass es jemandem auffaellt. Diese Tabelle macht die Aenderungen sichtbar - im Reiter "Verlauf" und als Zeile im Schicht-Dialog.

Tabelle: `aenderungen`

| Feld | Typ | Hinweise |
|------|-----|----------|
| `id` | `Int` | Primärschlüssel, Standard: `autoincrement()` |
| `tournamentId` | `Int?` |  |
| `userId` | `Int?` |  |
| `userName` | `String` |  |
| `art` | `String` |  |
| `beschreibung` | `String` |  |
| `objektTyp` | `String?` |  |
| `objektId` | `Int?` |  |
| `createdAt` | `DateTime` | Standard: `now()` |
| `tournament` | `Tournament?` | Beziehung über `tournamentId`, beim Löschen: Cascade |
| `user` | `User?` | Beziehung über `userId`, beim Löschen: SetNull |

## Club

Tabelle: `clubs`

| Feld | Typ | Hinweise |
|------|-----|----------|
| `id` | `Int` | Primärschlüssel, Standard: `autoincrement()` |
| `name` | `String` |  |
| `logo` | `String?` |  |
| `primaryColor` | `String` | Standard: `"#0d6efd"` |
| `secondaryColor` | `String` | Standard: `"#6c757d"` |
| `city` | `String?` |  |
| `teams` | `Team[]` | Gegenstück einer Beziehung (Liste) |
| `tournamentClubs` | `TournamentClub[]` | Gegenstück einer Beziehung (Liste) |
| `tournaments` | `Tournament[]` | Gegenstück einer Beziehung (Liste) |

## DaySlot

Ein Zeitfenster eines Turniertags - z.B. "07:45-11:30". Frueher wurde je Arbeitsbereich der Tagesvorlage ein eigener Slot angelegt, wodurch dieselbe Uhrzeit mehrfach nebeneinander stand und die Auswahl in der Oberflaeche unlesbar wurde. Jetzt gibt es ein Fenster genau einmal pro Tag; welche Bereiche darin arbeiten, sagen die Schichten.

Tabelle: `day_slots`

| Feld | Typ | Hinweise |
|------|-----|----------|
| `id` | `Int` | Primärschlüssel, Standard: `autoincrement()` |
| `tournamentDayId` | `Int` |  |
| `startMin` | `Int` |  |
| `endMin` | `Int` |  |
| `label` | `String?` |  |
| `color` | `String` | Standard: `"#3b98f8"` |
| `order` | `Int` | Standard: `0` |
| `day` | `TournamentDay` | Beziehung über `tournamentDayId`, beim Löschen: Cascade |
| `shifts` | `Shift[]` | Gegenstück einer Beziehung (Liste) |

Eindeutigkeit: `@@unique([tournamentDayId, startMin, endMin])`

## Field

Tabelle: `fields`

| Feld | Typ | Hinweise |
|------|-----|----------|
| `id` | `Int` | Primärschlüssel, Standard: `autoincrement()` |
| `tournamentId` | `Int` |  |
| `yearGroupId` | `Int?` |  |
| `name` | `String` | Standard: `"Feld 1"` |
| `status` | `String` | Standard: `"verfügbar"` |
| `tournament` | `Tournament` | Beziehung über `tournamentId`, beim Löschen: Cascade |
| `yearGroup` | `YearGroup?` | Beziehung über `yearGroupId`, beim Löschen: Cascade |
| `matches` | `Match[]` | Gegenstück einer Beziehung (Liste) |

## FoodCategory

Tabelle: `food_categories`

| Feld | Typ | Hinweise |
|------|-----|----------|
| `id` | `Int` | Primärschlüssel, Standard: `autoincrement()` |
| `name` | `String` |  |
| `icon` | `String` | Standard: `"🍽️"` |
| `order` | `Int` | Standard: `0` |
| `createdAt` | `DateTime` | Standard: `now()` |
| `items` | `FoodItem[]` | Gegenstück einer Beziehung (Liste) |
| `shoppingCatalogItems` | `ShoppingCatalogItem[]` | Gegenstück einer Beziehung (Liste) |

## FoodDonation

Tabelle: `food_donations`

| Feld | Typ | Hinweise |
|------|-----|----------|
| `id` | `Int` | Primärschlüssel, Standard: `autoincrement()` |
| `tournamentId` | `Int` |  |
| `userId` | `Int?` |  |
| `foodDonationSlotId` | `Int?` |  |
| `foodItemId` | `Int` |  |
| `quantity` | `Int` |  |
| `note` | `String?` |  |
| `createdAt` | `DateTime` | Standard: `now()` |
| `tournament` | `Tournament` | Beziehung über `tournamentId`, beim Löschen: Cascade |
| `user` | `User?` | Beziehung über `userId`, beim Löschen: Cascade |
| `foodItem` | `FoodItem` | Beziehung über `foodItemId`, beim Löschen: Cascade |
| `foodDonationSlot` | `FoodDonationSlot?` | Beziehung über `foodDonationSlotId`, beim Löschen: Cascade |

## FoodDonationSlot

Tabelle: `food_donation_slots`

| Feld | Typ | Hinweise |
|------|-----|----------|
| `id` | `Int` | Primärschlüssel, Standard: `autoincrement()` |
| `tournamentId` | `Int` |  |
| `yearGroupId` | `Int?` |  |
| `foodItemId` | `Int?` |  |
| `targetQuantity` | `Int` | Standard: `0` |
| `collected` | `Int` | Standard: `0` |
| `description` | `String?` |  |
| `createdAt` | `DateTime` | Standard: `now()` |
| `userId` | `Int?` |  |
| `yearGroup` | `YearGroup?` | Beziehung über `yearGroupId`, beim Löschen: Cascade |
| `tournament` | `Tournament` | Beziehung über `tournamentId`, beim Löschen: Cascade |
| `foodItem` | `FoodItem?` | Beziehung über `foodItemId`, beim Löschen: Cascade |
| `user` | `User?` | Beziehung über `userId`, beim Löschen: Cascade |
| `donations` | `FoodDonation[]` | Gegenstück einer Beziehung (Liste) |

Eindeutigkeit: `@@unique([tournamentId, yearGroupId, foodItemId])`

## FoodItem

Tabelle: `food_items`

| Feld | Typ | Hinweise |
|------|-----|----------|
| `id` | `Int` | Primärschlüssel, Standard: `autoincrement()` |
| `categoryId` | `Int` |  |
| `name` | `String` |  |
| `price` | `String?` |  |
| `unit` | `String` | Standard: `"Stk"` |
| `createdAt` | `DateTime` | Standard: `now()` |
| `foodDonationSlots` | `FoodDonationSlot[]` | Gegenstück einer Beziehung (Liste) |
| `donations` | `FoodDonation[]` | Gegenstück einer Beziehung (Liste) |
| `category` | `FoodCategory` | Beziehung über `categoryId`, beim Löschen: Cascade |

## GlobalDayTemplate

Tabelle: `global_day_templates`

| Feld | Typ | Hinweise |
|------|-----|----------|
| `id` | `Int` | Primärschlüssel, Standard: `autoincrement()` |
| `name` | `String` |  |
| `order` | `Int` | Standard: `0` |
| `isObsolete` | `Boolean` | Standard: `false` |
| `createdAt` | `DateTime` | Standard: `now()` |
| `workAreas` | `TemplateWorkArea[]` | Gegenstück einer Beziehung (Liste) |

## Group

Tabelle: `groups`

| Feld | Typ | Hinweise |
|------|-----|----------|
| `id` | `Int` | Primärschlüssel, Standard: `autoincrement()` |
| `name` | `String` |  |
| `order` | `Int` | Standard: `0` |
| `tournamentId` | `Int` |  |
| `yearGroupId` | `Int?` |  |
| `tournament` | `Tournament` | Beziehung über `tournamentId`, beim Löschen: Cascade |
| `yearGroup` | `YearGroup?` | Beziehung über `yearGroupId`, beim Löschen: Cascade |
| `teams` | `Team[]` | Gegenstück einer Beziehung (Liste) |

## KnockoutBracket

Tabelle: `knockout_brackets`

| Feld | Typ | Hinweise |
|------|-----|----------|
| `id` | `Int` | Primärschlüssel, Standard: `autoincrement()` |
| `tournamentId` | `Int` |  |
| `yearGroupId` | `Int?` |  |
| `name` | `String` |  |
| `runde` | `String` |  |
| `order` | `Int` | Standard: `0` |
| `tournament` | `Tournament` | Beziehung über `tournamentId`, beim Löschen: Cascade |
| `yearGroup` | `YearGroup?` | Beziehung über `yearGroupId`, beim Löschen: Cascade |
| `matches` | `Match[]` | Gegenstück einer Beziehung (Liste) |

## Match

Tabelle: `matches`

| Feld | Typ | Hinweise |
|------|-----|----------|
| `id` | `Int` | Primärschlüssel, Standard: `autoincrement()` |
| `tournamentId` | `Int` |  |
| `yearGroupId` | `Int?` |  |
| `bracketId` | `Int?` |  |
| `timeSlotId` | `Int?` |  |
| `fieldId` | `Int?` |  |
| `teamAId` | `Int?` |  |
| `teamBId` | `Int?` |  |
| `placeholderA` | `String?` |  |
| `placeholderB` | `String?` |  |
| `scoreA` | `Int?` |  |
| `scoreB` | `Int?` |  |
| `phase` | `String` | Standard: `"Gruppenphase"` |
| `runde` | `String?` |  |
| `bracketTyp` | `String?` |  |
| `siegerId` | `Int?` |  |
| `verliererId` | `Int?` |  |
| `status` | `String` | Standard: `"geplant"` |
| `time` | `DateTime` |  |
| `lowerBound` | `Int?` |  |
| `stage` | `Int?` |  |
| `upperBound` | `Int?` |  |
| `bracket` | `KnockoutBracket?` | Gegenstück einer Beziehung |
| `tournament` | `Tournament` | Beziehung über `tournamentId`, beim Löschen: Cascade |
| `timeSlot` | `TimeSlot?` | Beziehung über `timeSlotId`, beim Löschen: Cascade |
| `field` | `Field?` | Beziehung über `fieldId`, beim Löschen: Cascade |
| `teamA` | `Team?` | beim Löschen: Cascade, Gegenstück einer Beziehung |
| `teamB` | `Team?` | beim Löschen: Cascade, Gegenstück einer Beziehung |
| `yearGroup` | `YearGroup?` | Beziehung über `yearGroupId`, beim Löschen: Cascade |

## MaterialItem

Tabelle: `material_items`

| Feld | Typ | Hinweise |
|------|-----|----------|
| `id` | `Int` | Primärschlüssel, Standard: `autoincrement()` |
| `tournamentId` | `Int` |  |
| `name` | `String` |  |
| `quantity` | `Int` | Standard: `1` |
| `unit` | `String` | Standard: `"Stk"` |
| `done` | `Boolean` | Standard: `false` |
| `createdAt` | `DateTime` | Standard: `now()` |
| `tournament` | `Tournament` | Beziehung über `tournamentId`, beim Löschen: Cascade |

## PasswordResetToken

Tabelle: `password_reset_tokens`

| Feld | Typ | Hinweise |
|------|-----|----------|
| `id` | `Int` | Primärschlüssel, Standard: `autoincrement()` |
| `userId` | `Int?` |  |
| `token` | `String` | eindeutig |
| `expiresAt` | `DateTime` |  |
| `used` | `Boolean` | Standard: `false` |
| `createdAt` | `DateTime` | Standard: `now()` |
| `user` | `User?` | Beziehung über `userId`, beim Löschen: Cascade |

## PushSubscription

Tabelle: `push_subscriptions`

| Feld | Typ | Hinweise |
|------|-----|----------|
| `id` | `Int` | Primärschlüssel, Standard: `autoincrement()` |
| `userId` | `Int` |  |
| `endpoint` | `String` |  |
| `p256dh` | `String` |  |
| `auth` | `String` |  |
| `userAgent` | `String?` |  |
| `createdAt` | `DateTime` | Standard: `now()` |
| `user` | `User` | Beziehung über `userId`, beim Löschen: Cascade |

## Shift

Tabelle: `shifts`

| Feld | Typ | Hinweise |
|------|-----|----------|
| `id` | `Int` | Primärschlüssel, Standard: `autoincrement()` |
| `tournamentId` | `Int` |  |
| `tournamentDayId` | `Int` |  |
| `daySlotId` | `Int` |  |
| `tournamentWorkAreaId` | `Int` |  |
| `startMin` | `Int?` |  |
| `endMin` | `Int?` |  |
| `minVolunteers` | `Int` | Standard: `2` |
| `maxVolunteers` | `Int` | Standard: `8` |
| `description` | `String?` |  |
| `workArea` | `TournamentWorkArea` | Beziehung über `tournamentWorkAreaId`, beim Löschen: Cascade |
| `daySlot` | `DaySlot` | Beziehung über `daySlotId`, beim Löschen: Cascade |
| `day` | `TournamentDay` | Beziehung über `tournamentDayId`, beim Löschen: Cascade |
| `tournament` | `Tournament` | Beziehung über `tournamentId`, beim Löschen: Cascade |
| `volunteerShifts` | `VolunteerShift[]` | Gegenstück einer Beziehung (Liste) |

## ShoppingCatalogItem

Tabelle: `shopping_catalog_items`

| Feld | Typ | Hinweise |
|------|-----|----------|
| `id` | `Int` | Primärschlüssel, Standard: `autoincrement()` |
| `name` | `String` |  |
| `category` | `String?` |  |
| `unit` | `String` | Standard: `"Stk"` |
| `barcode` | `String?` | eindeutig |
| `foodCategoryId` | `Int?` |  |
| `createdAt` | `DateTime` | Standard: `now()` |
| `foodCategory` | `FoodCategory?` | Beziehung über `foodCategoryId` |
| `listItems` | `ShoppingListItem[]` | Gegenstück einer Beziehung (Liste) |

## ShoppingListItem

Tabelle: `shopping_list_items`

| Feld | Typ | Hinweise |
|------|-----|----------|
| `id` | `Int` | Primärschlüssel, Standard: `autoincrement()` |
| `tournamentId` | `Int` |  |
| `catalogItemId` | `Int` |  |
| `plannedQuantity` | `Int` | Standard: `0` |
| `purchasedQuantity` | `Int` | Standard: `0` |
| `note` | `String?` |  |
| `createdAt` | `DateTime` | Standard: `now()` |
| `catalogItem` | `ShoppingCatalogItem` | Beziehung über `catalogItemId`, beim Löschen: Cascade |
| `tournament` | `Tournament` | Beziehung über `tournamentId`, beim Löschen: Cascade |

Eindeutigkeit: `@@unique([tournamentId, catalogItemId])`

## StandingsEntry

Tabelle: `standings_entries`

| Feld | Typ | Hinweise |
|------|-----|----------|
| `id` | `Int` | Primärschlüssel, Standard: `autoincrement()` |
| `teamId` | `Int` | eindeutig |
| `tournamentId` | `Int` |  |
| `played` | `Int` | Standard: `0` |
| `won` | `Int` | Standard: `0` |
| `drawn` | `Int` | Standard: `0` |
| `lost` | `Int` | Standard: `0` |
| `goalsFor` | `Int` | Standard: `0` |
| `goalsAgainst` | `Int` | Standard: `0` |
| `points` | `Int` | Standard: `0` |
| `position` | `Int` | Standard: `0` |
| `team` | `Team` | beim Löschen: Cascade, Gegenstück einer Beziehung |
| `tournament` | `Tournament` | Beziehung über `tournamentId`, beim Löschen: Cascade |

Eindeutigkeit: `@@unique([teamId, tournamentId])`

## Team

Tabelle: `teams`

| Feld | Typ | Hinweise |
|------|-----|----------|
| `id` | `Int` | Primärschlüssel, Standard: `autoincrement()` |
| `name` | `String` |  |
| `groupId` | `Int?` |  |
| `tournamentId` | `Int?` |  |
| `yearGroupId` | `Int?` |  |
| `clubId` | `Int?` |  |
| `goalsFor` | `Int` | Standard: `0` |
| `goalsAgainst` | `Int` | Standard: `0` |
| `bracketTyp` | `String?` |  |
| `matchesAsA` | `Match[]` | Gegenstück einer Beziehung (Liste) |
| `matchesAsB` | `Match[]` | Gegenstück einer Beziehung (Liste) |
| `standingsEntry` | `StandingsEntry?` | Gegenstück einer Beziehung |
| `club` | `Club?` | Beziehung über `clubId`, beim Löschen: Cascade |
| `tournament` | `Tournament?` | Beziehung über `tournamentId`, beim Löschen: Cascade |
| `group` | `Group?` | Beziehung über `groupId`, beim Löschen: Cascade |
| `yearGroup` | `YearGroup?` | Beziehung über `yearGroupId`, beim Löschen: Cascade |

## TemplateWorkArea

Tabelle: `template_work_areas`

| Feld | Typ | Hinweise |
|------|-----|----------|
| `id` | `Int` | Primärschlüssel, Standard: `autoincrement()` |
| `templateId` | `Int` |  |
| `workAreaId` | `Int` |  |
| `startMin` | `Int` |  |
| `endMin` | `Int` |  |
| `order` | `Int` | Standard: `0` |
| `template` | `GlobalDayTemplate` | Beziehung über `templateId`, beim Löschen: Cascade |
| `workArea` | `WorkArea` | Beziehung über `workAreaId`, beim Löschen: Cascade |

Eindeutigkeit: `@@unique([templateId, workAreaId, startMin])`

## TimeSlot

Tabelle: `time_slots`

| Feld | Typ | Hinweise |
|------|-----|----------|
| `id` | `Int` | Primärschlüssel, Standard: `autoincrement()` |
| `tournamentId` | `Int` |  |
| `yearGroupId` | `Int?` |  |
| `date` | `DateTime` |  |
| `startTime` | `String` |  |
| `endTime` | `String` |  |
| `label` | `String?` |  |
| `order` | `Int` | Standard: `0` |
| `matches` | `Match[]` | Gegenstück einer Beziehung (Liste) |
| `tournament` | `Tournament` | Beziehung über `tournamentId`, beim Löschen: Cascade |
| `yearGroup` | `YearGroup?` | Beziehung über `yearGroupId`, beim Löschen: Cascade |

## Tournament

Tabelle: `tournaments`

| Feld | Typ | Hinweise |
|------|-----|----------|
| `id` | `Int` | Primärschlüssel, Standard: `autoincrement()` |
| `name` | `String` |  |
| `description` | `String?` |  |
| `startDate` | `DateTime` |  |
| `endDate` | `DateTime` |  |
| `status` | `String` | Standard: `"aktiv"` |
| `turnierModus` | `String` | Standard: `"GRUPPEN_KO"` |
| `teamsAdvancingPerGroup` | `Int` | Standard: `2` |
| `playoutAllPlacements` | `Boolean` | Standard: `false` |
| `thirdPlaceMatch` | `Boolean` | Standard: `true` |
| `qualificationRule` | `String?` |  |
| `createdAt` | `DateTime` | Standard: `now()` |
| `clubId` | `Int?` |  |
| `logo` | `String?` |  |
| `hasSponsor` | `Boolean` | Standard: `false` |
| `sponsorName` | `String?` |  |
| `sponsorUrl` | `String?` |  |
| `estimatedVisitors` | `Int?` |  |
| `teamCount` | `Int?` |  |
| `aenderungen` | `Aenderung[]` | Gegenstück einer Beziehung (Liste) |
| `fields` | `Field[]` | Gegenstück einer Beziehung (Liste) |
| `foodDonationSlots` | `FoodDonationSlot[]` | Gegenstück einer Beziehung (Liste) |
| `donations` | `FoodDonation[]` | Gegenstück einer Beziehung (Liste) |
| `groups` | `Group[]` | Gegenstück einer Beziehung (Liste) |
| `brackets` | `KnockoutBracket[]` | Gegenstück einer Beziehung (Liste) |
| `matches` | `Match[]` | Gegenstück einer Beziehung (Liste) |
| `materials` | `MaterialItem[]` | Gegenstück einer Beziehung (Liste) |
| `shifts` | `Shift[]` | Gegenstück einer Beziehung (Liste) |
| `shoppingListItems` | `ShoppingListItem[]` | Gegenstück einer Beziehung (Liste) |
| `standings` | `StandingsEntry[]` | Gegenstück einer Beziehung (Liste) |
| `teams` | `Team[]` | Gegenstück einer Beziehung (Liste) |
| `timeSlots` | `TimeSlot[]` | Gegenstück einer Beziehung (Liste) |
| `tournamentClubs` | `TournamentClub[]` | Gegenstück einer Beziehung (Liste) |
| `tournamentDays` | `TournamentDay[]` | Gegenstück einer Beziehung (Liste) |
| `memberships` | `TournamentMembership[]` | Gegenstück einer Beziehung (Liste) |
| `tournamentWorkAreas` | `TournamentWorkArea[]` | Gegenstück einer Beziehung (Liste) |
| `club` | `Club?` | Beziehung über `clubId` |
| `users` | `User[]` | Gegenstück einer Beziehung (Liste) |
| `volunteerShifts` | `VolunteerShift[]` | Gegenstück einer Beziehung (Liste) |
| `yearGroups` | `YearGroup[]` | Gegenstück einer Beziehung (Liste) |

## TournamentClub

Tabelle: `tournament_clubs`

| Feld | Typ | Hinweise |
|------|-----|----------|
| `id` | `Int` | Primärschlüssel, Standard: `autoincrement()` |
| `tournamentId` | `Int` |  |
| `clubId` | `Int` |  |
| `tournament` | `Tournament` | Beziehung über `tournamentId`, beim Löschen: Cascade |
| `club` | `Club` | Beziehung über `clubId`, beim Löschen: Cascade |

Eindeutigkeit: `@@unique([tournamentId, clubId])`

## TournamentDay

Tabelle: `tournament_days`

| Feld | Typ | Hinweise |
|------|-----|----------|
| `id` | `Int` | Primärschlüssel, Standard: `autoincrement()` |
| `tournamentId` | `Int` |  |
| `date` | `DateTime` |  |
| `order` | `Int` | Standard: `0` |
| `label` | `String?` |  |
| `sourceTemplateId` | `Int?` |  |
| `slots` | `DaySlot[]` | Gegenstück einer Beziehung (Liste) |
| `shifts` | `Shift[]` | Gegenstück einer Beziehung (Liste) |
| `dayWorkAreas` | `TournamentDayWorkArea[]` | Gegenstück einer Beziehung (Liste) |
| `tournament` | `Tournament` | Beziehung über `tournamentId`, beim Löschen: Cascade |

Eindeutigkeit: `@@unique([tournamentId, date])`

## TournamentDayWorkArea

Tabelle: `tournament_day_work_areas`

| Feld | Typ | Hinweise |
|------|-----|----------|
| `id` | `Int` | Primärschlüssel, Standard: `autoincrement()` |
| `tournamentId` | `Int` |  |
| `tournamentDayId` | `Int` |  |
| `tournamentWorkAreaId` | `Int` |  |
| `active` | `Boolean` | Standard: `true` |
| `targetHelpers` | `Int?` |  |
| `order` | `Int` | Standard: `0` |
| `workArea` | `TournamentWorkArea` | Beziehung über `tournamentWorkAreaId`, beim Löschen: Cascade |
| `day` | `TournamentDay` | Beziehung über `tournamentDayId`, beim Löschen: Cascade |

Eindeutigkeit: `@@unique([tournamentDayId, tournamentWorkAreaId])`

## TournamentMembership

Tabelle: `tournament_memberships`

| Feld | Typ | Hinweise |
|------|-----|----------|
| `id` | `Int` | Primärschlüssel, Standard: `autoincrement()` |
| `userId` | `Int` |  |
| `tournamentId` | `Int` |  |
| `createdAt` | `DateTime` | Standard: `now()` |
| `tournament` | `Tournament` | Beziehung über `tournamentId`, beim Löschen: Cascade |
| `user` | `User` | Beziehung über `userId`, beim Löschen: Cascade |

Eindeutigkeit: `@@unique([userId, tournamentId])`

## TournamentWorkArea

Tabelle: `tournament_work_areas`

| Feld | Typ | Hinweise |
|------|-----|----------|
| `id` | `Int` | Primärschlüssel, Standard: `autoincrement()` |
| `tournamentId` | `Int` |  |
| `sourceWorkAreaId` | `Int?` |  |
| `name` | `String` |  |
| `icon` | `String` | Standard: `"📍"` |
| `order` | `Int` | Standard: `0` |
| `color` | `String` | Standard: `"#3b98f8"` |
| `minVolunteers` | `Int` | Standard: `2` |
| `maxVolunteers` | `Int` | Standard: `8` |
| `operatingStartMin` | `Int?` |  |
| `operatingEndMin` | `Int?` |  |
| `active` | `Boolean` | Standard: `true` |
| `shifts` | `Shift[]` | Gegenstück einer Beziehung (Liste) |
| `dayWorkAreas` | `TournamentDayWorkArea[]` | Gegenstück einer Beziehung (Liste) |
| `tournament` | `Tournament` | Beziehung über `tournamentId`, beim Löschen: Cascade |

## User

Tabelle: `users`

| Feld | Typ | Hinweise |
|------|-----|----------|
| `id` | `Int` | Primärschlüssel, Standard: `autoincrement()` |
| `name` | `String` |  |
| `email` | `String?` |  |
| `phone` | `String?` |  |
| `password` | `String?` |  |
| `role` | `String` | Standard: `"HELPER"` |
| `tournamentId` | `Int?` |  |
| `consentGiven` | `Boolean` | Standard: `false` |
| `consentDate` | `DateTime?` |  |
| `recoveryPin` | `String?` |  |
| `createdAt` | `DateTime` | Standard: `now()` |
| `lastLoginAt` | `DateTime?` |  |
| `lastActivityAt` | `DateTime?` |  |
| `ohneZugang` | `Boolean` | Standard: `false` |
| `kontaktpersonId` | `Int?` |  |
| `kontaktperson` | `User?` | beim Löschen: SetNull, Gegenstück einer Beziehung |
| `betreute` | `User[]` | Gegenstück einer Beziehung (Liste) |
| `foodDonationSlots` | `FoodDonationSlot[]` | Gegenstück einer Beziehung (Liste) |
| `foodDonations` | `FoodDonation[]` | Gegenstück einer Beziehung (Liste) |
| `resetTokens` | `PasswordResetToken[]` | Gegenstück einer Beziehung (Liste) |
| `pushSubscriptions` | `PushSubscription[]` | Gegenstück einer Beziehung (Liste) |
| `notifications` | `UserNotification[]` | Gegenstück einer Beziehung (Liste) |
| `aenderungen` | `Aenderung[]` | Gegenstück einer Beziehung (Liste) |
| `tournamentMemberships` | `TournamentMembership[]` | Gegenstück einer Beziehung (Liste) |
| `tournament` | `Tournament?` | Beziehung über `tournamentId` |
| `children` | `UserChild[]` | Gegenstück einer Beziehung (Liste) |
| `shifts` | `VolunteerShift[]` | Gegenstück einer Beziehung (Liste) |
| `webAuthnCredentials` | `WebAuthnCredential[]` | Gegenstück einer Beziehung (Liste) |
| `trainedYearGroups` | `YearGroup[]` | Gegenstück einer Beziehung (Liste) |
| `userRoles` | `UserRole[]` | Gegenstück einer Beziehung (Liste) |

## UserChild

Tabelle: `volunteer_children`

| Feld | Typ | Hinweise |
|------|-----|----------|
| `id` | `Int` | Primärschlüssel, Standard: `autoincrement()` |
| `userId` | `Int?` |  |
| `childName` | `String` |  |
| `childYear` | `Int` |  |
| `user` | `User?` | Beziehung über `userId`, beim Löschen: Cascade |

## UserNotification

Nachrichten an einen Nutzer, die auch OHNE Push ankommen muessen. Push erreicht in der Praxis nur eine Minderheit: die App wird selten installiert und Benachrichtigungen noch seltener erlaubt. Aenderungen am Dienstplan wuerden damit an den meisten Helfern vorbeigehen. Deshalb wird jede solche Meldung zusaetzlich hier abgelegt und beim naechsten Oeffnen der App oben angezeigt, bis der Nutzer sie bestaetigt.

Tabelle: `user_notifications`

| Feld | Typ | Hinweise |
|------|-----|----------|
| `id` | `Int` | Primärschlüssel, Standard: `autoincrement()` |
| `userId` | `Int` |  |
| `title` | `String` |  |
| `body` | `String` |  |
| `url` | `String?` |  |
| `stellvertretendFuer` | `String?` |  |
| `createdAt` | `DateTime` | Standard: `now()` |
| `readAt` | `DateTime?` |  |
| `user` | `User` | Beziehung über `userId`, beim Löschen: Cascade |

## UserRole

Rollen eines Nutzers. Bewusst eine eigene Tabelle statt einer Liste im User: eine Person kann mehrere Hüte tragen (z.B. Admin UND Trainer), und zwei Stellen filtern serverseitig nach Rolle (Erst-Admin-Zählung, Ausschluss von Admins bei der Inaktivitäts-Löschung) - das bliebe mit einer JSON-Spalte nur über Zeichenkettensuche möglich. User.role existiert übergangsweise weiter und wird als höchste Rolle mitgeschrieben, damit ein Rollback auf eine ältere Image-Version die Anmeldung nicht zerlegt. Nach ein paar stabilen Releases kann die Spalte entfallen.

Tabelle: `user_roles`

| Feld | Typ | Hinweise |
|------|-----|----------|
| `id` | `Int` | Primärschlüssel, Standard: `autoincrement()` |
| `userId` | `Int` |  |
| `role` | `String` |  |
| `user` | `User` | Beziehung über `userId`, beim Löschen: Cascade |

Eindeutigkeit: `@@unique([userId, role])`

## VolunteerShift

Tabelle: `volunteer_shifts`

| Feld | Typ | Hinweise |
|------|-----|----------|
| `id` | `Int` | Primärschlüssel, Standard: `autoincrement()` |
| `userId` | `Int?` |  |
| `tournamentId` | `Int?` |  |
| `shiftId` | `Int?` |  |
| `date` | `DateTime` |  |
| `slot` | `String` |  |
| `role` | `String` |  |
| `areaId` | `String?` |  |
| `ratingWorkload` | `Int?` |  |
| `ratingOrganization` | `Int?` |  |
| `ratingFun` | `Int?` |  |
| `ratingComment` | `String?` |  |
| `reminderSentBefore` | `Boolean` | Standard: `false` |
| `thanksSentAfter` | `Boolean` | Standard: `false` |
| `tournament` | `Tournament?` | Beziehung über `tournamentId`, beim Löschen: Cascade |
| `user` | `User?` | Beziehung über `userId`, beim Löschen: Cascade |
| `shift` | `Shift?` | Beziehung über `shiftId`, beim Löschen: Cascade |

## WebAuthnCredential

Tabelle: `webauthn_credentials`

| Feld | Typ | Hinweise |
|------|-----|----------|
| `id` | `Int` | Primärschlüssel, Standard: `autoincrement()` |
| `userId` | `Int` |  |
| `credentialId` | `String` | eindeutig |
| `publicKey` | `String` |  |
| `counter` | `Int` | Standard: `0` |
| `transports` | `String?` |  |
| `deviceType` | `String?` |  |
| `backedUp` | `Boolean` | Standard: `false` |
| `label` | `String?` |  |
| `createdAt` | `DateTime` | Standard: `now()` |
| `user` | `User` | Beziehung über `userId`, beim Löschen: Cascade |

## WorkArea

Tabelle: `arbeitsbereiche`

| Feld | Typ | Hinweise |
|------|-----|----------|
| `id` | `Int` | Primärschlüssel, Standard: `autoincrement()` |
| `name` | `String` |  |
| `icon` | `String` | Standard: `"📍"` |
| `order` | `Int` | Standard: `0` |
| `minVolunteers` | `Int` | Standard: `2` |
| `maxVolunteers` | `Int` | Standard: `8` |
| `color` | `String` | Standard: `"#3b98f8"` |
| `operatingStartMin` | `Int?` |  |
| `operatingEndMin` | `Int?` |  |
| `isStandard` | `Boolean` | Standard: `false` |
| `isObsolete` | `Boolean` | Standard: `false` |
| `templateWorkAreas` | `TemplateWorkArea[]` | Gegenstück einer Beziehung (Liste) |
| `categories` | `WorkAreaCategory[]` | Gegenstück einer Beziehung (Liste) |

## WorkAreaCategory

Tabelle: `work_area_categories`

| Feld | Typ | Hinweise |
|------|-----|----------|
| `id` | `Int` | Primärschlüssel, Standard: `autoincrement()` |
| `name` | `String` | eindeutig |
| `order` | `Int` | Standard: `0` |
| `color` | `String` | Standard: `"#e7f1ff"` |
| `isObsolete` | `Boolean` | Standard: `false` |
| `createdAt` | `DateTime` | Standard: `now()` |
| `workAreas` | `WorkArea[]` | Gegenstück einer Beziehung (Liste) |

## YearGroup

Tabelle: `year_groups`

| Feld | Typ | Hinweise |
|------|-----|----------|
| `id` | `Int` | Primärschlüssel, Standard: `autoincrement()` |
| `name` | `String` |  |
| `birthYearStart` | `Int` |  |
| `birthYearEnd` | `Int` |  |
| `order` | `Int` | Standard: `0` |
| `isActive` | `Boolean` | Standard: `true` |
| `fields` | `Field[]` | Gegenstück einer Beziehung (Liste) |
| `foodDonationSlots` | `FoodDonationSlot[]` | Gegenstück einer Beziehung (Liste) |
| `groups` | `Group[]` | Gegenstück einer Beziehung (Liste) |
| `brackets` | `KnockoutBracket[]` | Gegenstück einer Beziehung (Liste) |
| `matches` | `Match[]` | Gegenstück einer Beziehung (Liste) |
| `teams` | `Team[]` | Gegenstück einer Beziehung (Liste) |
| `timeSlots` | `TimeSlot[]` | Gegenstück einer Beziehung (Liste) |
| `tournaments` | `Tournament[]` | Gegenstück einer Beziehung (Liste) |
| `trainers` | `User[]` | Gegenstück einer Beziehung (Liste) |
