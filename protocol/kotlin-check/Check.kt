// Decode every TS fixture with the generated Kotlin types, re-encode, and
// require the exact same JSON. Run via `mise run //protocol:kotlin-check`.
import java.io.File
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import remuse.protocol.Call
import remuse.protocol.Envelope
import remuse.protocol.State

fun main(args: Array<String>) {
  val json = Json { explicitNulls = true }
  val fixtures = json.parseToJsonElement(File(args[0]).readText()).jsonObject
  fun <T> roundTrip(name: String, serializer: KSerializer<T>) {
    val original = fixtures.getValue(name)
    val again = json.encodeToJsonElement(serializer, json.decodeFromJsonElement(serializer, original))
    check(again == original) { "$name changed in a round trip:\n$original\n$again" }
  }
  roundTrip("envelopes", ListSerializer(Envelope.serializer()))
  roundTrip("calls", ListSerializer(Call.serializer()))
  roundTrip("state", State.serializer())
  println("kotlin: fixtures round-trip unchanged")
}
